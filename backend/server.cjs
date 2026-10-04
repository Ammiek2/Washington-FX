require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================================================
// WASHINGTON FX CONFIGURATION
// =====================================================

const CTRADER_CLIENT_ID = process.env.CTRADER_CLIENT_ID;
const CTRADER_CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET;

const CTRADER_REDIRECT_URI =
    process.env.CTRADER_REDIRECT_URI ||
    "https://washington-fx-production-074e.up.railway.app/auth/ctrader/callback";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// =====================================================
// cTRADER CONNECTIONS
// =====================================================

// cTrader keeps LIVE and DEMO completely separate.
const CTRADER_LIVE_URL = "wss://live.ctraderapi.com:5036";
const CTRADER_DEMO_URL = "wss://demo.ctraderapi.com:5036";

let liveSocket = null;
let demoSocket = null;

const sessions = new Map();
const tradingTokens = new Map();

// =====================================================
// CONFIGURATION STATUS
// =====================================================

const ctraderConfigured =
    Boolean(CTRADER_CLIENT_ID) &&
    Boolean(CTRADER_CLIENT_SECRET) &&
    Boolean(CTRADER_REDIRECT_URI);

const supabaseConfigured =
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_SERVICE_ROLE_KEY);

// =====================================================
// HELPERS
// =====================================================

function makeMessage(payloadType, payload = {}) {
    return JSON.stringify({
        clientMsgId: crypto.randomUUID(),
        payloadType,
        payload
    });
}

function getSocket(environment = "live") {
    return environment === "demo" ? demoSocket : liveSocket;
}

function setSocket(environment, socket) {
    if (environment === "demo") {
        demoSocket = socket;
    } else {
        liveSocket = socket;
    }
}

// =====================================================
// CONNECT TO cTRADER
// =====================================================

function connectCtrader(environment = "live") {

    if (!ctraderConfigured) {
        console.log(
            `cTrader ${environment} connection skipped: credentials not configured.`
        );
        return;
    }

    const existing = getSocket(environment);

    if (
        existing &&
        existing.readyState === WebSocket.OPEN
    ) {
        console.log(`cTrader ${environment} connection already active.`);
        return;
    }

    const url =
        environment === "demo"
            ? CTRADER_DEMO_URL
            : CTRADER_LIVE_URL;

    console.log(`Connecting to cTrader ${environment}: ${url}`);

    const socket = new WebSocket(url);

    setSocket(environment, socket);

    socket.on("open", () => {

        console.log(`cTrader ${environment} WebSocket connected.`);

        // ProtoOAApplicationAuthReq
        socket.send(
            makeMessage(2100, {
                clientId: CTRADER_CLIENT_ID,
                clientSecret: CTRADER_CLIENT_SECRET
            })
        );

        console.log(
            `cTrader ${environment} application authentication request sent.`
        );
    });

    socket.on("message", (raw) => {

        try {

            const message = JSON.parse(raw.toString());

            console.log(
                `cTrader ${environment} message:`,
                JSON.stringify(message)
            );

            handleCtraderMessage(environment, message);

        } catch (error) {

            console.error(
                `cTrader ${environment} message parsing error:`,
                error
            );
        }
    });

    socket.on("error", (error) => {

        console.error(
            `cTrader ${environment} WebSocket error:`,
            error.message
        );
    });

    socket.on("close", () => {

        console.log(
            `cTrader ${environment} WebSocket disconnected.`
        );

        setSocket(environment, null);

        setTimeout(() => {
            connectCtrader(environment);
        }, 5000);
    });
}

// =====================================================
// HANDLE cTRADER MESSAGES
// =====================================================

function handleCtraderMessage(environment, message) {

    const payloadType = Number(message.payloadType);

    // Application authentication response
    if (payloadType === 2101) {

        console.log(
            `cTrader ${environment} application authentication successful.`
        );

        return;
    }

    // Error event
    if (
        payloadType === 2142 ||
        payloadType === 10001
    ) {

        console.error(
            `cTrader ${environment} API error:`,
            message
        );

        return;
    }

    // Heartbeat
    if (payloadType === 51) {

        const socket = getSocket(environment);

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {
            socket.send(
                makeMessage(51, {})
            );
        }

        return;
    }
}

// =====================================================
// HEARTBEAT
// =====================================================

setInterval(() => {

    ["live", "demo"].forEach((environment) => {

        const socket = getSocket(environment);

        if (
            socket &&
            socket.readyState === WebSocket.OPEN
        ) {
            socket.send(
                makeMessage(51, {})
            );
        }

    });

}, 10000);

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {

    res.json({
        platform: "Washington FX",
        status: "online",
        environment: "server-side",
        backend: "Railway",
        broker: "cTrader Open API",
        ctraderConfigured,
        supabaseConfigured,
        liveConnection:
            liveSocket &&
            liveSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected",
        demoConnection:
            demoSocket &&
            demoSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected"
    });

});

// =====================================================
// SYSTEM STATUS
// =====================================================

app.get("/api/status", (req, res) => {

    res.json({

        platform: "Washington FX",

        backend: "online",

        serverTime:
            new Date().toISOString(),

        ctrader:
            ctraderConfigured
                ? "configured"
                : "not configured",

        supabase:
            supabaseConfigured
                ? "configured"
                : "not configured",

        tradingEngine: "server-side",

        liveConnection:
            liveSocket &&
            liveSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected",

        demoConnection:
            demoSocket &&
            demoSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected"

    });

});

// =====================================================
// cTRADER AUTHORIZATION
// =====================================================

app.get("/auth/ctrader", (req, res) => {

    if (!ctraderConfigured) {

        return res.status(503).json({

            success: false,

            error:
                "cTrader is not configured.",

            requiredVariables: [
                "CTRADER_CLIENT_ID",
                "CTRADER_CLIENT_SECRET",
                "CTRADER_REDIRECT_URI"
            ]

        });

    }

    const state =
        crypto.randomBytes(32).toString("hex");

    sessions.set(state, {

        createdAt: Date.now()

    });

    const authorizationUrl =
        "https://id.ctrader.com/my/settings/openapi/grantingaccess/" +
        `?client_id=${encodeURIComponent(CTRADER_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(CTRADER_REDIRECT_URI)}` +
        `&scope=trading` +
        `&product=web` +
        `&state=${encodeURIComponent(state)}`;

    res.json({

        success: true,

        authorizationUrl

    });

});

// =====================================================
// cTRADER CALLBACK
// =====================================================

app.get("/auth/ctrader/callback", async (req, res) => {

    const {
        code,
        state
    } = req.query;

    if (!code || !state) {

        return res.status(400).json({

            success: false,

            error:
                "Missing authorization code or state."

        });

    }

    if (!sessions.has(state)) {

        return res.status(403).json({

            success: false,

            error:
                "Invalid authorization state."

        });

    }

    sessions.delete(state);

    try {

        const params =
            new URLSearchParams({

                grant_type:
                    "authorization_code",

                code:
                    String(code),

                redirect_uri:
                    CTRADER_REDIRECT_URI,

                client_id:
                    CTRADER_CLIENT_ID,

                client_secret:
                    CTRADER_CLIENT_SECRET

            });

        const response =
            await fetch(
                "https://openapi.ctrader.com/apps/token?" +
                params.toString()
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            data.errorCode
        ) {

            console.error(
                "cTrader authentication failed:",
                data
            );

            return res.status(400).json({

                success: false,

                error:
                    data.description ||
                    "cTrader authentication failed."

            });

        }

        // Store token server-side for now.
        // Do NOT send the token back to the browser.
        const tokenId =
            crypto.randomUUID();

        tradingTokens.set(
            tokenId,
            {
                accessToken:
                    data.accessToken,

                refreshToken:
                    data.refreshToken,

                expiresIn:
                    data.expiresIn,

                createdAt:
                    Date.now()
            }
        );

        console.log(
            "cTrader authorization successful."
        );

        res.json({

            success: true,

            message:
                "cTrader authorization successful.",

            tokenStored:
                true,

            expiresIn:
                data.expiresIn

        });

    } catch (error) {

        console.error(
            "cTrader callback error:",
            error
        );

        res.status(500).json({

            success: false,

            error:
                "Authentication server error."

        });

    }

});

// =====================================================
// ACCOUNT
// =====================================================

app.get("/api/account", (req, res) => {

    res.json({

        platform:
            "Washington FX",

        broker:
            "cTrader",

        connection:
            ctraderConfigured
                ? "configured"
                : "not configured",

        liveConnection:
            liveSocket &&
            liveSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected",

        status:
            "cTrader account authentication required"

    });

});

// =====================================================
// MARKET
// =====================================================

app.get("/api/market/:symbol", (req, res) => {

    const symbol =
        String(req.params.symbol)
            .toUpperCase();

    res.json({

        symbol,

        broker:
            "cTrader",

        connection:
            liveSocket &&
            liveSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected",

        status:
            "market-data connection ready"

    });

});

// =====================================================
// ORDERS
// =====================================================

app.post("/api/orders", (req, res) => {

    try {

        const {

            accountId,

            symbolId,

            side,

            volume,

            stopLoss,

            takeProfit

        } = req.body;

        if (!accountId) {

            return res.status(400).json({

                success: false,

                error:
                    "Account ID required."

            });

        }

        if (!symbolId) {

            return res.status(400).json({

                success: false,

                error:
                    "Symbol ID required."

            });

        }

        if (
            !["BUY", "SELL"]
                .includes(side)
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Invalid trade side."

            });

        }

        if (
            !volume ||
            Number(volume) <= 0
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Invalid volume."

            });

        }

        const socket =
            liveSocket;

        if (
            !socket ||
            socket.readyState !== WebSocket.OPEN
        ) {

            return res.status(503).json({

                success: false,

                error:
                    "cTrader live connection is not available."

            });

        }

        // At this stage we have validated the request
        // and confirmed that the live WebSocket exists.
        //
        // The next execution layer will:
        //
        // 1. Authenticate the trading account
        // 2. Resolve the cTrader symbol
        // 3. Convert volume to cTrader units
        // 4. Send ProtoOANewOrderReq
        // 5. Wait for ProtoOANewOrderRes
        // 6. Return the actual broker result

        return res.status(202).json({

            success: true,

            status:
                "order_received",

            message:
                "Order received by Washington FX server. Broker execution layer is being prepared.",

            accountId,

            symbolId,

            side,

            volume,

            stopLoss:
                stopLoss || null,

            takeProfit:
                takeProfit || null

        });

    } catch (error) {

        console.error(
            "Order error:",
            error
        );

        res.status(500).json({

            success: false,

            error:
                "Order processing failed."

        });

    }

});

// =====================================================
// CLOSE POSITION
// =====================================================

app.post("/api/positions/close", (req, res) => {

    const {

        accountId,

        positionId,

        volume

    } = req.body;

    if (
        !accountId ||
        !positionId
    ) {

        return res.status(400).json({

            success: false,

            error:
                "Account and position are required."

        });

    }

    res.status(202).json({

        success: true,

        status:
            "close_request_received",

        accountId,

        positionId,

        volume:
            volume || null

    });

});

// =====================================================
// ADMIN STATUS
// =====================================================

app.get("/api/admin/status", (req, res) => {

    res.json({

        platform:
            "Washington FX",

        adminSystem:
            "online",

        broker:
            "cTrader",

        ctraderConfigured,

        supabaseConfigured,

        liveConnection:
            liveSocket &&
            liveSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected",

        demoConnection:
            demoSocket &&
            demoSocket.readyState === WebSocket.OPEN
                ? "connected"
                : "disconnected"

    });

});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        error:
            "Endpoint not found",

        path:
            req.originalUrl

    });

});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

    console.log(
        "--------------------------------"
    );

    console.log(
        "WASHINGTON FX"
    );

    console.log(
        "BACKEND ONLINE"
    );

    console.log(
        "--------------------------------"
    );

    console.log(
        `Server running on port ${PORT}`
    );

    console.log(
        `cTrader configured: ${
            ctraderConfigured
                ? "YES"
                : "NO"
        }`
    );

    console.log(
        `Supabase configured: ${
            supabaseConfigured
                ? "YES"
                : "NO"
        }`
    );

    // Start both connections.
    // cTrader keeps demo and live environments separate.
    connectCtrader("live");
    connectCtrader("demo");

});
