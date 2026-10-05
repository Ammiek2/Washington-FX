/* =========================================================
   WASHINGTON FX
   DEMO TRADING ENGINE
   ========================================================= */

const SUPABASE_URL =
    "https://plddteltleqayzcpuxom.supabase.co";

const SUPABASE_ANON_KEY =
    "sb_publishable_jX6_GQggT_GDK2Kv_jNBcqA_frXVuZWv";

const API_BASE =
    "https://washington-fx-production-074e.up.railway.app";

const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );


/* =========================================================
   SYMBOLS
   ========================================================= */

const SYMBOLS = {

    EURUSD: {
        price: 1.08250,
        spread: 0.00012,
        pip: 0.0001,
        volatility: 0.00035
    },

    GBPUSD: {
        price: 1.29120,
        spread: 0.00015,
        pip: 0.0001,
        volatility: 0.00045
    },

    USDJPY: {
        price: 149.250,
        spread: 0.012,
        pip: 0.01,
        volatility: 0.055
    },

    USDCHF: {
        price: 0.88120,
        spread: 0.00014,
        pip: 0.0001,
        volatility: 0.00035
    },

    AUDUSD: {
        price: 0.67520,
        spread: 0.00013,
        pip: 0.0001,
        volatility: 0.00030
    },

    USDCAD: {
        price: 1.36150,
        spread: 0.00016,
        pip: 0.0001,
        volatility: 0.00040
    },

    NZDUSD: {
        price: 0.61580,
        spread: 0.00015,
        pip: 0.0001,
        volatility: 0.00032
    },

    XAUUSD: {
        price: 2650.00,
        spread: 0.35,
        pip: 0.10,
        volatility: 2.50
    },

    BTCUSD: {
        price: 62000,
        spread: 18,
        pip: 1,
        volatility: 130
    },

    ETHUSD: {
        price: 2450,
        spread: 3,
        pip: 1,
        volatility: 12
    },

    US30: {
        price: 42000,
        spread: 5,
        pip: 1,
        volatility: 85
    },

    NAS100: {
        price: 19500,
        spread: 4,
        pip: 1,
        volatility: 65
    }

};


const TIMEFRAMES = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400
};


/* =========================================================
   STATE
   ========================================================= */

const state = {

    user: null,
    profile: null,
    admin: false,

    symbol: "EURUSD",
    timeframe: "15m",
    chartType: "candlestick",

    balance: 10000,

    positions: [],
    orders: [],
    history: [],
    wallet: [],

    ticket: 100001,

    market: {},

    chart: null,
    series: null,

    lastCandle: null,
    candles: [],

    simulationStarted: false

};


/* =========================================================
   HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}


function money(value) {

    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2
    }).format(Number(value) || 0);

}


function priceFormat(symbol, price) {

    if (["BTCUSD"].includes(symbol)) {
        return Number(price).toFixed(2);
    }

    if (["XAUUSD", "US30", "NAS100", "ETHUSD"].includes(symbol)) {
        return Number(price).toFixed(2);
    }

    if (symbol === "USDJPY") {
        return Number(price).toFixed(3);
    }

    return Number(price).toFixed(5);
}


function toast(message) {

    const box = $("toast");

    box.textContent = message;

    box.classList.add("show");

    setTimeout(() => {
        box.classList.remove("show");
    }, 2500);

}


function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


/* =========================================================
   LOCAL STORAGE
   ========================================================= */

function storageKey() {

    if (!state.user) return null;

    return `washington_fx_demo_${state.user.id}`;

}


function saveState() {

    if (!state.user) return;

    localStorage.setItem(
        storageKey(),
        JSON.stringify({
            balance: state.balance,
            positions: state.positions,
            orders: state.orders,
            history: state.history,
            wallet: state.wallet,
            ticket: state.ticket
        })
    );

}


function loadState() {

    if (!state.user) return;

    const raw = localStorage.getItem(storageKey());

    if (!raw) return;

    try {

        const saved = JSON.parse(raw);

        state.balance =
            Number(saved.balance ?? 10000);

        state.positions =
            saved.positions || [];

        state.orders =
            saved.orders || [];

        state.history =
            saved.history || [];

        state.wallet =
            saved.wallet || [];

        state.ticket =
            Number(saved.ticket ?? 100001);

    } catch (error) {

        console.error(error);

    }

}


/* =========================================================
   AUTH
   ========================================================= */

$("loginTab").onclick = () => {

    $("loginTab").classList.add("active");
    $("registerTab").classList.remove("active");

    $("loginForm").classList.remove("hidden");
    $("registerForm").classList.add("hidden");

};


$("registerTab").onclick = () => {

    $("registerTab").classList.add("active");
    $("loginTab").classList.remove("active");

    $("registerForm").classList.remove("hidden");
    $("loginForm").classList.add("hidden");

};


function authMessage(message, error = false) {

    $("authMessage").textContent = message;

    $("authMessage").style.color =
        error ? "#f0445b" : "#19c37d";

}


$("registerBtn").onclick = async () => {

    const name =
        $("registerName").value.trim();

    const email =
        $("registerEmail").value.trim();

    const password =
        $("registerPassword").value;

    if (!name || !email || password.length < 6) {

        authMessage(
            "Enter your name, valid email and password of at least 6 characters.",
            true
        );

        return;
    }


    const { data, error } =
        await supabaseClient.auth.signUp({

            email,
            password,

            options: {
                data: {
                    display_name: name
                }
            }

        });


    if (error) {

        authMessage(error.message, true);

        return;
    }


    if (data.session) {

        await startApplication(data.session.user);

    } else {

        authMessage(
            "Account created. Check your email if email confirmation is enabled."
        );

    }

};


$("loginBtn").onclick = async () => {

    const email =
        $("loginEmail").value.trim();

    const password =
        $("loginPassword").value;

    if (!email || !password) {

        authMessage(
            "Enter your email and password.",
            true
        );

        return;
    }


    const { data, error } =
        await supabaseClient.auth.signInWithPassword({
            email,
            password
        });


    if (error) {

        authMessage(error.message, true);

        return;
    }


    await startApplication(data.user);

};


$("forgotBtn").onclick = async () => {

    const email =
        $("loginEmail").value.trim();

    if (!email) {

        authMessage(
            "Enter your email first.",
            true
        );

        return;
    }


    const redirect =
        window.location.origin +
        window.location.pathname;


    const { error } =
        await supabaseClient.auth.resetPasswordForEmail(
            email,
            {
                redirectTo: redirect
            }
        );


    if (error) {

        authMessage(error.message, true);

        return;
    }


    authMessage("Password reset email sent.");

};


$("logoutBtn").onclick = async () => {

    await supabaseClient.auth.signOut();

    state.user = null;

    $("appScreen").classList.add("hidden");
    $("authScreen").classList.remove("hidden");

};


/* =========================================================
   PROFILE / ADMIN
   ========================================================= */

async function loadProfile() {

    if (!state.user) return;

    const { data } =
        await supabaseClient
            .from("profiles")
            .select("*")
            .eq("id", state.user.id)
            .maybeSingle();

    state.profile = data || null;

}


async function checkAdmin() {

    if (!state.user) return false;

    const { data } =
        await supabaseClient
            .from("admin_users")
            .select("user_id")
            .eq("user_id", state.user.id)
            .maybeSingle();

    state.admin = !!data;

    document
        .querySelector(".admin-nav")
        .classList.toggle(
            "hidden",
            !state.admin
        );

    return state.admin;

}


async function loadDemoAccountNumber() {

    if (!state.user) return;

    const { data } =
        await supabaseClient
            .from("demo_accounts")
            .select("account_number")
            .eq("user_id", state.user.id)
            .maybeSingle();

    if (data) {

        $("accountNumber").textContent =
            data.account_number;

        $("accountNumberLarge").textContent =
            data.account_number;

    }

}


/* =========================================================
   APPLICATION START
   ========================================================= */

async function startApplication(user) {

    state.user = user;

    loadState();

    await loadProfile();

    await checkAdmin();

    await loadDemoAccountNumber();

    $("authScreen").classList.add("hidden");

    $("appScreen").classList.remove("hidden");

    $("userEmail").textContent =
        user.email || "";

    $("accountName").textContent =
        state.profile?.display_name ||
        user.user_metadata?.display_name ||
        "Trader";

    $("accountEmail").textContent =
        user.email || "";

    initMarket();

    initChart();

    navigate("dashboard");

    updateAll();

    if (!state.simulationStarted) {

        state.simulationStarted = true;

        setInterval(simulationTick, 1000);

    }

}


/* =========================================================
   MARKET
   ========================================================= */

function initMarket() {

    Object.keys(SYMBOLS).forEach(symbol => {

        const config = SYMBOLS[symbol];

        if (!state.market[symbol]) {

            state.market[symbol] = {
                price: config.price,
                previous: config.price,
                history: []
            };

        }

        if (
            state.market[symbol].history.length === 0
        ) {

            createInitialHistory(symbol);

        }

    });

}


function createInitialHistory(symbol) {

    const config = SYMBOLS[symbol];

    let price =
        state.market[symbol].price;

    const now =
        Math.floor(Date.now() / 1000);

    const step =
        TIMEFRAMES[state.timeframe];

    const history = [];

    for (let i = 150; i >= 0; i--) {

        const movement =
            (Math.random() - .5) *
            config.volatility *
            5;

        price += movement;

        if (price <= 0) {
            price = config.price;
        }

        const candleTime =
            now -
            i * step;

        history.push({
            time: candleTime,
            open: price - movement,
            high: Math.max(
                price,
                price + Math.abs(movement)
            ),
            low: Math.min(
                price,
                price - Math.abs(movement)
            ),
            close: price
        });

    }

    state.market[symbol].price = price;

    state.market[symbol].history = history;

}


function getBid(symbol) {

    const m = state.market[symbol];

    return m.price - SYMBOLS[symbol].spread / 2;

}


function getAsk(symbol) {

    const m = state.market[symbol];

    return m.price + SYMBOLS[symbol].spread / 2;

}


function moveMarket(symbol) {

    const config = SYMBOLS[symbol];

    const m = state.market[symbol];

    const random =
        Math.random() - .5;

    const momentum =
        Math.sin(Date.now() / 30000) * .2;

    const move =
        (random + momentum) *
        config.volatility;

    m.previous = m.price;

    m.price += move;

    if (m.price <= 0) {
        m.price = config.price;
    }

    updateCandle(symbol);

}


/* =========================================================
   CANDLES
   ========================================================= */

function updateCandle(symbol) {

    const m =
        state.market[symbol];

    const timeframe =
        TIMEFRAMES[state.timeframe];

    const now =
        Math.floor(Date.now() / 1000);

    const candleTime =
        Math.floor(now / timeframe) *
        timeframe;

    let candle =
        m.history[m.history.length - 1];

    if (!candle || candle.time !== candleTime) {

        candle = {

            time: candleTime,

            open: m.price,

            high: m.price,

            low: m.price,

            close: m.price

        };

        m.history.push(candle);

        if (m.history.length > 500) {
            m.history.shift();
        }

    } else {

        candle.high =
            Math.max(candle.high, m.price);

        candle.low =
            Math.min(candle.low, m.price);

        candle.close =
            m.price;

    }


    if (
        state.symbol === symbol &&
        state.series
    ) {

        updateChart();

    }

}


/* =========================================================
   CHART
   ========================================================= */

function initChart() {

    const container =
        $("chart");

    if (!container) return;

    state.chart =
        LightweightCharts.createChart(
            container,
            {

                layout: {
                    background: {
                        color: "#0d1928"
                    },
                    textColor: "#8da0b5"
                },

                grid: {
                    vertLines: {
                        color: "#142638"
                    },
                    horzLines: {
                        color: "#142638"
                    }
                },

                rightPriceScale: {
                    borderColor: "#1d3045"
                },

                timeScale: {
                    borderColor: "#1d3045",
                    timeVisible: true
                }

            }
        );


    createChartSeries();

    window.addEventListener(
        "resize",
        resizeChart
    );

}


function resizeChart() {

    if (!state.chart) return;

    const box =
        $("chart").getBoundingClientRect();

    state.chart.applyOptions({
        width: box.width,
        height: box.height
    });

}


function createChartSeries() {

    if (!state.chart) return;

    if (state.series) {

        try {
            state.chart.removeSeries(state.series);
        } catch {}

    }


    const options = {

        upColor: "#19c37d",
        downColor: "#f0445b",
        borderVisible: false,
        wickUpColor: "#19c37d",
        wickDownColor: "#f0445b"

    };


    switch (state.chartType) {

        case "bar":

            state.series =
                state.chart.addBarSeries(options);

            break;

        case "line":

            state.series =
                state.chart.addLineSeries({
                    lineWidth: 2
                });

            break;

        case "area":

            state.series =
                state.chart.addAreaSeries({
                    lineWidth: 2,
                    topColor: "rgba(30,136,255,.35)",
                    bottomColor: "rgba(30,136,255,.02)"
                });

            break;

        case "baseline":

            state.series =
                state.chart.addBaselineSeries({
                    baseValue: {
                        type: "price",
                        price: SYMBOLS[state.symbol].price
                    }
                });

            break;

        case "histogram":

            state.series =
                state.chart.addHistogramSeries({
                    priceFormat: {
                        type: "volume"
                    },
                    priceScaleId: ""
                });

            break;

        default:

            state.series =
                state.chart.addCandlestickSeries(options);

    }


    updateChart();

}


function updateChart() {

    if (!state.series) return;

    const candles =
        state.market[state.symbol].history;

    if (!candles) return;


    if (
        state.chartType === "candlestick" ||
        state.chartType === "bar"
    ) {

        state.series.setData(
            candles.map(c => ({
                time: c.time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }))
        );

    }


    else if (
        state.chartType === "line" ||
        state.chartType === "area" ||
        state.chartType === "baseline"
    ) {

        state.series.setData(
            candles.map(c => ({
                time: c.time,
                value: c.close
            }))
        );

    }


    else if (state.chartType === "histogram") {

        state.series.setData(
            candles.map(c => ({
                time: c.time,
                value: Math.abs(c.close - c.open)
            }))
        );

    }


    state.chart.timeScale().fitContent();

}


/* =========================================================
   SIMULATION ENGINE
   ========================================================= */

function simulationTick() {

    if (!state.user) return;

    Object.keys(SYMBOLS).forEach(
        moveMarket
    );

    processPendingOrders();

    processStops();

    updateAll();

    saveState();

}


/* =========================================================
   P/L
   ========================================================= */

function positionProfit(position) {

    const symbol =
        position.symbol;

    const market =
        state.market[symbol];

    if (!market) return 0;

    const current =
        position.side === "BUY"
            ? getBid(symbol)
            : getAsk(symbol);

    const difference =
        position.side === "BUY"
            ? current - position.entry
            : position.entry - current;

    const pip =
        SYMBOLS[symbol].pip;

    const pips =
        difference / pip;

    const pipValue =
        symbol === "USDJPY"
            ? 6.7
            : 10;

    return pips *
        pipValue *
        position.volume;

}


function floatingProfit() {

    return state.positions.reduce(
        (total, position) =>
            total + positionProfit(position),
        0
    );

}


function positionMargin(position) {

    const price =
        state.market[position.symbol].price;

    return (
        price *
        position.volume *
        100000
    ) / 100;

}


function usedMargin() {

    return state.positions.reduce(
        (total, position) =>
            total + positionMargin(position),
        0
    );

}


function equity() {

    return state.balance +
        floatingProfit();

}


function freeMargin() {

    return equity() -
        usedMargin();

}


function marginLevel() {

    const margin =
        usedMargin();

    if (margin <= 0) {
        return Infinity;
    }

    return (
        equity() /
        margin
    ) * 100;

}


/* =========================================================
   TRADING
   =============
