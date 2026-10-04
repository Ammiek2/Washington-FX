require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CTRADER_CLIENT_ID = process.env.CTRADER_CLIENT_ID;
const CTRADER_CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET;

const CTRADER_REDIRECT_URI =
    process.env.CTRADER_REDIRECT_URI ||
    "https://washington-fx-production-074e.up.railway.app/auth/ctrader/callback";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CTRADER_LIVE_URL = "wss://live.ctraderapi.com:5036";
const CTRADER_DEMO_URL = "wss://demo.ctraderapi.com:5036";

const ctraderConfigured =
    Boolean(CTRADER_CLIENT_ID) &&
    Boolean(CTRADER_CLIENT_SECRET) &&
    Boolean(CTRADER_REDIRECT_URI);

const supabaseConfigured =
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_SERVICE_ROLE_KEY);

/*
===========================================================
WASHINGTON FX
cTRADER OPEN API CONNECTION
===========================================================
*/

const sockets = {
    live: null,
    demo: null
};

const socketState = {
    live: {
        connected: false,
        applicationAuthorized: false,
        accountAuthorized: false,
        accountId: null,
        pendingActivation: false,
        reconnectTimer: null
    },

    demo: {
        connected: false,
        applicationAuthorized: false,
        accountAuthorized: false,
        accountId: null,
        pendingActivation: false,
        reconnectTimer: null
    }
};

/*
OAuth tokens are kept in memory for now.

IMPORTANT:
For production we will later move encrypted token storage
into Supabase/server-side storage.
*/

const tradingTokens = new Map();

/*
===========================================================
UTILITY FUNCTIONS
===========================================================
*/

function makeMessage(payloadType, payload = {}) {
    return JSON.stringify({
        clientMsgId: crypto.randomUUID(),
        payloadType,
        payload
    });
}

function sendToCtrader(environment, payloadType, payload = {}) {
    const socket = sockets[environment];

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    socket.send(makeMessage(payloadType, payload));
    return true;
}

function clearReconnectTimer(environment) {
    const state = socketState[environment];

    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
}

/*
Do NOT reconnect every 5 seconds when cTrader says the
application is not active.

Instead, wait 60 seconds.
*/

function scheduleReconnect(environment, delay = 60000) {
    const state = socketState[environment];

    if (state.pendingActivation && delay < 60000) {
        delay = 60000;
    }

    clearReconnectTimer(environment);

    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;

        console.log(
            `Retrying cTrader ${environment} connection...`
        );

        connectCtrader(environment);
    }, delay);
}

/*
===========================================================
cTRADER CONNECTION
===========================================================
*/

function connectCtrader(environment) {
    const state = socketState[environment];

    clearReconnectTimer(environment);

    if (
        sockets[environment] &&
        (
            sockets[environment].readyState === WebSocket.OPEN ||
            sockets[environment].readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    const url =
        environment === "live"
            ? CTRADER_LIVE_URL
            : CTRADER_DEMO_URL;

    console.log(
        `Connecting to cTrader ${environment}: ${url}`
    );

    const ws = new WebSocket(url);

    sockets[environment] = ws;

    ws.on("open", () => {
        state.connected = true;
        state.applicationAuthorized = false;
        state.accountAuthorized = false;

        console.log(
            `cTrader ${environment} WebSocket connected.`
        );

        /*
        ProtoOAApplicationAuthReq = 2100
        */

        const sent = sendToCtrader(
            environment,
            2100,
            {
                clientId: CTRADER_CLIENT_ID,
                clientSecret: CTRADER_CLIENT_SECRET
            }
        );

        if (!sent) {
            console.error(
                `Unable to send cTrader ${environment} application authentication.`
            );
        }
    });

    ws.on("message", (data) => {
        handleCtraderMessage(environment, data);
    });

    ws.on("error", (error) => {
        console.error(
            `cTrader ${environment} WebSocket error:`,
            error.message
        );
    });

    ws.on("close", () => {
        state.connected = false;
        state.applicationAuthorized = false;
        state.accountAuthorized = false;

        console.log(
            `cTrader ${environment} WebSocket disconnected.`
        );

        /*
        If the application is waiting for cTrader approval,
        don't flood Railway logs.
        */

        if (state.pendingActivation) {
            console.log(
                `cTrader ${environment} application is still pending activation.`
            );

            scheduleReconnect(environment, 60000);
        } else {
            scheduleReconnect(environment, 15000);
        }
    });
}

/*
===========================================================
cTRADER MESSAGE HANDLER
===========================================================
*/

function handleCtraderMessage(environment, rawData) {
    let message;

    try {
        message = JSON.parse(rawData.toString());
    } catch (error) {
        console.error(
            `Invalid JSON received from cTrader ${environment}.`
        );
        return;
    }

    const payloadType = message.payloadType;
    const payload = message.payload || {};

    /*
    2101 = ProtoOAApplicationAuthRes
    */

    if (payloadType === 2101) {
        socketState[environment].applicationAuthorized = true;
        socketState[environment].pendingActivation = false;

        console.log(
            `cTrader ${environment} application authentication SUCCESS.`
        );

        /*
        If we already have an OAuth access token,
        continue with account authentication.
        */

        const token = getLatestToken();

        if (token) {
            requestAccountList(
                environment,
                token.accessToken
            );
        }

        return;
    }

    /*
    2105 in the normal cTrader payload list is Version response,
    so account-list messages may be represented by the API's
    corresponding account-list payload in the connection.
    */

    /*
    Account list response.
    */

    if (
        payloadType === 2105 &&
        (
            payload.ctidTraderAccount ||
            payload.ctidTraderAccounts
        )
    ) {
        handleAccountList(
            environment,
            payload
        );

        return;
    }

    /*
    2103 = ProtoOAAccountAuthRes
    */

    if (payloadType === 2103) {
        const accountId =
            payload.ctidTraderAccountId ||
            payload.ctidTraderAccountID;

        socketState[environment].accountAuthorized = true;
        socketState[environment].accountId = accountId;

        console.log(
            `cTrader ${environment} account authentication SUCCESS. Account: ${accountId}`
        );

        return;
    }

    /*
    51 = heartbeat
    */

    if (payloadType === 51) {
        return;
    }

    /*
    2142 = Open API error response
    */

    if (payloadType === 2142) {
        const errorCode = payload.errorCode || "UNKNOWN_ERROR";
        const description =
            payload.description || "No description";

        console.error(
            `cTrader ${environment} API error: ${errorCode} - ${description}`
        );

        /*
        Error 101:
        CH_CLIENT_AUTH_FAILURE

        Your current problem.

        Do NOT reconnect every few seconds.
        */

        if (errorCode === "CH_CLIENT_AUTH_FAILURE") {
            socketState[environment].pendingActivation = true;

            console.log(
                `cTrader ${environment}: Open API application is not ACTIVE yet.`
            );

            console.log(
                `Waiting for cTrader to activate the Open API application before retrying.`
            );

            return;
        }

        return;
    }

    console.log(
        `cTrader ${environment} message:`,
        JSON.stringify(message)
    );
}

/*
===========================================================
ACCOUNT AUTHENTICATION
===========================================================
*/

function getLatestToken() {
    const tokens = Array.from(tradingTokens.values());

    if (tokens.length === 0) {
        return null;
    }

    return tokens[tokens.length - 1];
}

function requestAccountList(environment, accessToken) {
    if (!socketState[environment].applicationAuthorized) {
        return false;
    }

    /*
    ProtoOAGetAccountListByAccessTokenReq

    cTrader's documented flow requires the access token
    after application authentication.
    */

    return sendToCtrader(
        environment,
        2104,
        {
            accessToken
        }
    );
}

function handleAccountList(environment, payload) {
    const accounts =
        payload.ctidTraderAccount ||
        payload.ctidTraderAccounts ||
        [];

    if (!Array.isArray(accounts) || accounts.length === 0) {
        console.log(
            `cTrader ${environment}: no authorized trading accounts returned.`
        );

        return;
    }

    const token = getLatestToken();

    if (!token) {
        console.log(
            `cTrader ${environment}: account list received but no access token is available.`
        );

        return;
    }

    /*
    Select the first account for now.

    Later we will let the Washington FX user/admin select
    the exact connected trading account.
    */

    const firstAccount = accounts[0];

    const accountId =
        firstAccount.ctidTraderAccountId ||
        firstAccount.ctidTraderAccountID;

    if (!accountId) {
        console.error(
            `cTrader ${environment}: account ID was not returned.`
        );

        return;
    }

    socketState[environment].accountId = accountId;

    console.log(
        `cTrader ${environment}: account found: ${accountId}`
    );

    /*
    ProtoOAAccountAuthReq = 2102
    */

    sendToCtrader(
        environment,
        2102,
        {
            ctidTraderAccountId: Number(accountId),
            accessToken: token.accessToken
        }
    );
}

/*
===========================================================
OAUTH
===========================================================
*/

app.get("/auth/ctrader", (req, res) => {
    if (!ctraderConfigured) {
        return res.status(500).json({
            status: "error",
            message: "cTrader environment variables are not configured."
        });
    }

    const scope = "trading";

    const authorizationUrl =
        "https://id.ctrader.com/my/settings/openapi/grantingaccess/?" +
        new URLSearchParams({
            client_id: CTRADER_CLIENT_ID,
            redirect_uri: CTRADER_REDIRECT_URI,
            scope,
            product: "web"
        }).toString();

    res.redirect(authorizationUrl);
});

/*
===========================================================
OAUTH CALLBACK
===========================================================
*/

app.get("/auth/ctrader/callback", async (req, res) => {
    try {
        const code = req.query.code;

        if (!code) {
            return res.status(400).json({
                status: "error",
                message: "Missing cTrader authorization code."
            });
        }

        const params = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: CTRADER_REDIRECT_URI,
            client_id: CTRADER_CLIENT_ID,
            client_secret: CTRADER_CLIENT_SECRET
        });

        const response = await fetch(
            "https://openapi.ctrader.com/apps/token?" +
            params.toString()
        );

        const data = await response.json();

        if (!response.ok || !data.accessToken) {
            console.error(
                "cTrader token exchange failed:",
                data
            );

            return res.status(400).json({
                status: "error",
                message: "cTrader token exchange failed.",
                details: data
            });
        }

        const tokenId = crypto.randomUUID();

        tradingTokens.set(tokenId, {
            tokenId,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            expiresIn: data.expiresIn,
            createdAt: Date.now()
        });

        console.log(
            "cTrader OAuth authorization successful."
        );

        /*
        Once OAuth is complete, ask both connections
        to authenticate the account.
        */

        for (const environment of ["demo", "live"]) {
            const state = socketState[environment];

            if (
                sockets[environment] &&
                sockets[environment].readyState === WebSocket.OPEN &&
                state.applicationAuthorized
            ) {
                requestAccountList(
                    environment,
                    data.accessToken
                );
            }
        }

        res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Washington FX</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{
    font-family:Arial,sans-serif;
    background:#07101c;
    color:white;
    text-align:center;
    padding:60px 20px;
}
.box{
    max-width:600px;
    margin:auto;
    padding:30px;
    border-radius:15px;
    background:#101c2c;
}
</style>
</head>
<body>
<div class="box">
<h1>Washington FX</h1>
<h2>cTrader authorization successful</h2>
<p>Your cTrader authorization has been received.</p>
<p>You can return to Washington FX.</p>
</div>
</body>
</html>
        `);

    } catch (error) {
        console.error(
            "cTrader callback error:",
            error
        );

        res.status(500).json({
            status: "error",
            message: "cTrader callback failed."
        });
    }
});

/*
===========================================================
STATUS
===========================================================
*/

app.get("/api/admin/status", (req, res) => {
    res.json({
        status: "online",

        ctrader: {
            configured: ctraderConfigured,

            live: {
                connected: socketState.live.connected,
                applicationAuthorized:
                    socketState.live.applicationAuthorized,
                accountAuthorized:
                    socketState.live.accountAuthorized,
                accountId:
                    socketState.live.accountId,
                waitingForActivation:
                    socketState.live.pendingActivation
            },

            demo: {
                connected: socketState.demo.connected,
                applicationAuthorized:
                    socketState.demo.applicationAuthorized,
                accountAuthorized:
                    socketState.demo.accountAuthorized,
                accountId:
                    socketState.demo.accountId,
                waitingForActivation:
                    socketState.demo.pendingActivation
            }
        },

        supabase: {
            configured: supabaseConfigured
        }
    });
});

/*
===========================================================
ACCOUNT
===========================================================
*/

app.get("/api/account", (req, res) => {
    const environment =
        String(req.query.environment || "demo").toLowerCase();

    if (
        environment !== "demo" &&
        environment !== "live"
    ) {
        return res.status(400).json({
            status: "error",
            message: "Invalid environment."
        });
    }

    const state = socketState[environment];

    if (!state.accountAuthorized) {
        return res.json({
            connected: state.connected,
            authorized: false,
            balance: 0,
            equity: 0,
            margin: 0,
            freeMargin: 0,
            positions: []
        });
    }

    /*
    Account data will be connected to ProtoOATraderReq
    in the next backend stage.
    */

    res.json({
        connected: state.connected,
        authorized: true,
        accountId: state.accountId,
        balance: 0,
        equity: 0,
        margin: 0,
        freeMargin: 0,
        positions: []
    });
});

/*
===========================================================
MARKET
===========================================================
*/

app.get("/api/market/:symbol", (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();

    res.json({
        symbol,
        status: "pending",
        message:
            "Market data connection will use the authenticated cTrader account."
    });
});

/*
===========================================================
LIVE/DEMO ORDER ENDPOINT
===========================================================
*/

app.post("/api/orders", (req, res) => {
    const {
        accountType = "DEMO",
        symbol,
        side,
        volume,
        stake,
        entry,
        stopLoss,
        takeProfit
    } = req.body;

    const environment =
        String(accountType).toLowerCase() === "live"
            ? "live"
            : "demo";

    const state = socketState[environment];

    if (!symbol || !side) {
        return res.status(400).json({
            status: "error",
            message: "Symbol and side are required."
        });
    }

    if (!volume && !stake) {
        return res.status(400).json({
            status: "error",
            message: "Order volume is required."
        });
    }

    if (!state.connected) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} connection is not available.`
        });
    }

    if (!state.applicationAuthorized) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} application is not authorized yet.`
        });
    }

    if (!state.accountAuthorized) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} trading account is not authorized yet.`
        });
    }

    /*
    IMPORTANT:

    We deliberately do not send a real order here yet.

    The remaining order layer requires:
    1. cTrader symbol ID mapping
    2. correct volume conversion
    3. trade-side conversion
    4. market-order validation
    5. SL/TP conversion
    6. order response handling
    7. database trade recording

    This prevents Washington FX from pretending that an order
    executed when cTrader has not confirmed execution.
    */

    return res.status(501).json({
        status: "not_ready",
        message:
            "cTrader account is authenticated. Order execution is the next broker-execution step.",
        environment,
        symbol,
        side,
        volume: volume || stake,
        entry: entry || null,
        stopLoss: stopLoss || null,
        takeProfit: takeProfit || null
    });
});

/*
===========================================================
CLOSE POSITION
===========================================================
*/

app.post("/api/positions/close", (req, res) => {
    const {
        accountType = "DEMO",
        positionId,
        volume
    } = req.body;

    const environment =
        String(accountType).toLowerCase() === "live"
            ? "live"
            : "demo";

    const state = socketState[environment];

    if (!positionId) {
        return res.status(400).json({
            status: "error",
            message: "Position ID is required."
        });
    }

    if (!state.connected) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} connection is not available.`
        });
    }

    if (!state.accountAuthorized) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} account is not authorized.`
        });
    }

    /*
    ProtoOAClosePositionReq = 2111

    Actual sending will be enabled together with the
    confirmed order-execution layer.
    */

    return res.status(501).json({
        status: "not_ready",
        message:
            "cTrader account is authenticated. Position closing is the next execution step.",
        positionId,
        volume: volume || null
    });
});

/*
===========================================================
FRONTEND COMPATIBILITY
===========================================================
*/

app.post("/api/orders/:id/close", (req, res) => {
    req.body = {
        ...req.body,
        positionId: req.params.id
    };

    const environment =
        String(req.body.accountType || "DEMO").toLowerCase();

    const state =
        environment === "live"
            ? socketState.live
            : socketState.demo;

    if (!state.connected) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} connection is not available.`
        });
    }

    if (!state.accountAuthorized) {
        return res.status(503).json({
            status: "error",
            message:
                `cTrader ${environment} account is not authorized.`
        });
    }

    return res.status(501).json({
        status: "not_ready",
        message:
            "Position closing is waiting for the confirmed cTrader execution layer.",
        positionId: req.params.id
    });
});

/*
===========================================================
ROOT
===========================================================
*/

app.get("/", (req, res) => {
    res.json({
        name: "Washington FX",
        status: "online",
        version: "1.0.0",
        ctraderConfigured,
        supabaseConfigured
    });
});

/*
===========================================================
404
===========================================================
*/

app.use((req, res) => {
    res.status(404).json({
        status: "error",
        message: "Endpoint not found."
    });
});

/*
===========================================================
START SERVER
===========================================================
*/

app.listen(PORT, () => {
    console.log("");
    console.log("======================================");
    console.log("WASHINGTON FX");
    console.log("BACKEND ONLINE");
    console.log("======================================");
    console.log(`Server running on port ${PORT}`);
    console.log(
        `cTrader configured: ${ctraderConfigured ? "YES" : "NO"}`
    );
    console.log(
        `Supabase configured: ${supabaseConfigured ? "YES" : "NO"}`
    );
    console.log("======================================");
});

/*
===========================================================
START cTRADER CONNECTIONS
===========================================================
*/

if (ctraderConfigured) {
    connectCtrader("demo");
    connectCtrader("live");
} else {
    console.log(
        "cTrader connection not started because credentials are missing."
    );
}
