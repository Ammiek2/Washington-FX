require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

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
    "https://washington-fx-production.up.railway.app/auth/ctrader/callback";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ctraderConfigured =
    Boolean(CTRADER_CLIENT_ID) &&
    Boolean(CTRADER_CLIENT_SECRET) &&
    Boolean(CTRADER_REDIRECT_URI);

const supabaseConfigured =
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_SERVICE_ROLE_KEY);

const sessions = new Map();

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
    res.json({
        platform: "Washington FX",
        status: "online",
        environment: "live-ready",
        backend: "Railway",
        broker: "cTrader Open API",
        ctraderConfigured: ctraderConfigured,
        supabaseConfigured: supabaseConfigured
    });
});

// =====================================================
// SYSTEM STATUS
// =====================================================

app.get("/api/status", (req, res) => {
    res.json({
        platform: "Washington FX",
        backend: "online",
        serverTime: new Date().toISOString(),
        ctrader: ctraderConfigured ? "configured" : "not configured",
        supabase: supabaseConfigured ? "configured" : "not configured",
        tradingEngine: "server-side"
    });
});

// =====================================================
// cTRADER AUTHORIZATION
// =====================================================

app.get("/auth/ctrader", (req, res) => {

    if (!ctraderConfigured) {
        return res.status(503).json({
            success: false,
            error: "cTrader is not configured.",
            requiredVariables: [
                "CTRADER_CLIENT_ID",
                "CTRADER_CLIENT_SECRET",
                "CTRADER_REDIRECT_URI"
            ]
        });
    }

    const state = crypto.randomBytes(32).toString("hex");

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
        authorizationUrl: authorizationUrl
    });
});

// =====================================================
// cTRADER CALLBACK
// =====================================================

app.get("/auth/ctrader/callback", async (req, res) => {

    const { code, state } = req.query;

    if (!code || !state) {
        return res.status(400).json({
            success: false,
            error: "Missing authorization code or state."
        });
    }

    if (!sessions.has(state)) {
        return res.status(403).json({
            success: false,
            error: "Invalid authorization state."
        });
    }

    sessions.delete(state);

    if (!ctraderConfigured) {
        return res.status(503).json({
            success: false,
            error: "cTrader is not configured."
        });
    }

    try {

        const params = new URLSearchParams({
            grant_type: "authorization_code",
            code: String(code),
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

            console.error("cTrader authentication failed:", data);

            return res.status(400).json({
                success: false,
                error:
                    data.description ||
                    "cTrader authentication failed."
            });
        }

        res.json({
            success: true,
            message: "cTrader authorization successful.",
            expiresIn: data.expiresIn
        });

    } catch (error) {

        console.error("cTrader callback error:", error);

        res.status(500).json({
            success: false,
            error: "Authentication server error."
        });
    }
});

// =====================================================
// ACCOUNT
// =====================================================

app.get("/api/account", (req, res) => {

    res.json({
        platform: "Washington FX",
        broker: "cTrader",
        connection:
            ctraderConfigured
                ? "configured"
                : "not configured",
        status: "account endpoint ready"
    });
});

// =====================================================
// MARKET DATA
// =====================================================

app.get("/api/market/:symbol", (req, res) => {

    const symbol = String(req.params.symbol).toUpperCase();

    res.json({
        symbol: symbol,
        broker: "cTrader",
        status:
            ctraderConfigured
                ? "broker connection configured"
                : "awaiting cTrader configuration"
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
                error: "Account ID required."
            });
        }

        if (!symbolId) {
            return res.status(400).json({
                success: false,
                error: "Symbol ID required."
            });
        }

        if (!["BUY", "SELL"].includes(side)) {
            return res.status(400).json({
                success: false,
                error: "Invalid trade side."
            });
        }

        if (!volume || Number(volume) <= 0) {
            return res.status(400).json({
                success: false,
                error: "Invalid volume."
            });
        }

        res.json({
            success: true,
            status: "order_request_validated",
            accountId: accountId,
            symbolId: symbolId,
            side: side,
            volume: volume,
            stopLoss: stopLoss || null,
            takeProfit: takeProfit || null
        });

    } catch (error) {

        console.error("Order error:", error);

        res.status(500).json({
            success: false,
            error: "Order processing failed."
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

    if (!accountId || !positionId) {
        return res.status(400).json({
            success: false,
            error: "Account and position are required."
        });
    }

    res.json({
        success: true,
        status: "close_request_validated",
        accountId: accountId,
        positionId: positionId,
        volume: volume || null
    });
});

// =====================================================
// ADMIN STATUS
// =====================================================

app.get("/api/admin/status", (req, res) => {

    res.json({
        platform: "Washington FX",
        adminSystem: "online",
        broker: "cTrader",
        ctraderConfigured: ctraderConfigured,
        supabaseConfigured: supabaseConfigured
    });
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {

    res.status(404).json({
        success: false,
        error: "Endpoint not found",
        path: req.originalUrl
    });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

    console.log("--------------------------------");
    console.log("WASHINGTON FX");
    console.log("BACKEND ONLINE");
    console.log("--------------------------------");
    console.log(`Server running on port ${PORT}`);
    console.log(
        `cTrader configured: ${ctraderConfigured ? "YES" : "NO"}`
    );
    console.log(
        `Supabase configured: ${supabaseConfigured ? "YES" : "NO"}`
    );
});
