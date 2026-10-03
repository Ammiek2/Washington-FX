import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CTRADER_CLIENT_ID = process.env.CTRADER_CLIENT_ID;
const CTRADER_CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET;
const CTRADER_REDIRECT_URI = process.env.CTRADER_REDIRECT_URI;

if (!CTRADER_CLIENT_ID || !CTRADER_CLIENT_SECRET) {
    console.error("Missing cTrader credentials.");
    process.exit(1);
}

/*
    ----------------------------------------
    WASHINGTON FX LIVE BACKEND
    ----------------------------------------
*/

const sessions = new Map();

/*
    Health check
*/

app.get("/", (req, res) => {
    res.json({
        platform: "Washington FX",
        status: "online",
        environment: "live-ready",
        broker: "cTrader Open API"
    });
});

/*
    Generate cTrader authorization URL
*/

app.get("/auth/ctrader", (req, res) => {

    const state = crypto.randomBytes(32).toString("hex");

    sessions.set(state, {
        createdAt: Date.now()
    });

    const url =
        "https://id.ctrader.com/my/settings/openapi/grantingaccess/" +
        `?client_id=${encodeURIComponent(CTRADER_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(CTRADER_REDIRECT_URI)}` +
        `&scope=trading` +
        `&product=web` +
        `&state=${encodeURIComponent(state)}`;

    res.json({
        authorizationUrl: url
    });
});

/*
    OAuth callback
*/

app.get("/auth/ctrader/callback", async (req, res) => {

    const { code, state } = req.query;

    if (!code || !state) {
        return res.status(400).json({
            error: "Missing authorization data"
        });
    }

    if (!sessions.has(state)) {
        return res.status(403).json({
            error: "Invalid authorization state"
        });
    }

    sessions.delete(state);

    try {

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

        if (!response.ok || data.errorCode) {
            return res.status(400).json({
                error: data.description || "cTrader authentication failed"
            });
        }

        /*
            IMPORTANT:
            Tokens should eventually be encrypted and stored
            in the secure database/backend.
        */

        res.json({
            success: true,
            message: "cTrader account authorization successful",
            expiresIn: data.expiresIn
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Authentication server error"
        });
    }
});

/*
    LIVE ACCOUNT CONFIGURATION
*/

app.get("/api/account", async (req, res) => {

    /*
        This endpoint will later:
        1. Load encrypted user's cTrader token
        2. Authenticate with cTrader
        3. Retrieve account information
        4. Return balance/equity/margin/etc.
    */

    res.json({
        platform: "Washington FX",
        brokerConnection: "ready",
        tradingEngine: "server-side"
    });
});

/*
    MARKET DATA
*/

app.get("/api/market/:symbol", async (req, res) => {

    const symbol = req.params.symbol;

    /*
        Live bid/ask subscription will be connected here.

        Example symbols:
        EURUSD
        GBPUSD
        USDJPY
        XAUUSD
    */

    res.json({
        symbol,
        status: "awaiting broker subscription"
    });
});

/*
    PLACE REAL ORDER
*/

app.post("/api/orders", async (req, res) => {

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
                error: "Account ID required"
            });
        }

        if (!symbolId) {
            return res.status(400).json({
                error: "Symbol ID required"
            });
        }

        if (!["BUY", "SELL"].includes(side)) {
            return res.status(400).json({
                error: "Invalid trade side"
            });
        }

        if (!volume || volume <= 0) {
            return res.status(400).json({
                error: "Invalid volume"
            });
        }

        /*
            SECURITY CHECKS GO HERE

            - authenticated user
            - account ownership
            - owner/admin restrictions
            - margin availability
            - maximum lot size
            - symbol permissions
            - trading hours
            - risk limits
            - duplicate order protection
        */

        /*
            NEXT:
            Send ProtoOANewOrderReq through the
            cTrader live connection.
        */

        res.json({
            success: true,
            status: "order_request_received",
            accountId,
            symbolId,
            side,
            volume,
            stopLoss: stopLoss || null,
            takeProfit: takeProfit || null
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Order processing failed"
        });
    }
});

/*
    CLOSE POSITION
*/

app.post("/api/positions/close", async (req, res) => {

    const {
        accountId,
        positionId,
        volume
    } = req.body;

    if (!accountId || !positionId) {
        return res.status(400).json({
            error: "Account and position are required"
        });
    }

    /*
        NEXT:
        Send ProtoOAClosePositionReq
        through the live cTrader connection.
    */

    res.json({
        success: true,
        status: "close_request_received",
        accountId,
        positionId,
        volume: volume || null
    });
});

/*
    ADMIN SECURITY
*/

app.get("/api/admin/status", (req, res) => {

    /*
        This endpoint will be protected by:
        Supabase authentication
        + owner role
        + server-side authorization.
    */

    res.json({
        platform: "Washington FX",
        adminSystem: "online",
        broker: "cTrader",
        liveTrading: true
    });
});

/*
    START SERVER
*/

app.listen(PORT, () => {

    console.log("--------------------------------");
    console.log("WASHINGTON FX");
    console.log("LIVE BACKEND ONLINE");
    console.log("--------------------------------");
    console.log(`Server running on port ${PORT}`);
});
