const http = require("http");

const PORT = process.env.PORT || 3000;

const SUPABASE_URL =
    process.env.SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "";


function send(
    res,
    status,
    data
) {

    res.writeHead(
        status,
        {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers":
                "Content-Type, Authorization",
            "Access-Control-Allow-Methods":
                "GET,POST,OPTIONS"
        }
    );

    res.end(
        JSON.stringify(data)
    );

}


const server =
    http.createServer(
        async (req, res) => {

            if (req.method === "OPTIONS") {

                res.writeHead(
                    204,
                    {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers":
                            "Content-Type, Authorization",
                        "Access-Control-Allow-Methods":
                            "GET,POST,OPTIONS"
                    }
                );

                res.end();

                return;
            }


            if (
                req.method === "GET" &&
                req.url === "/health"
            ) {

                send(
                    res,
                    200,
                    {
                        ok: true,
                        service:
                            "washington-fx-backend",
                        mode:
                            "simulation",
                        time:
                            new Date().toISOString()
                    }
                );

                return;
            }


            if (
                req.method === "GET" &&
                req.url === "/config-status"
            ) {

                send(
                    res,
                    200,
                    {
                        supabaseConfigured:
                            Boolean(SUPABASE_URL),
                        serverKeyConfigured:
                            Boolean(
                                SUPABASE_SERVICE_ROLE_KEY
                            ),
                        realTrading:
                            false,
                        realMoney:
                            false
                    }
                );

                return;
            }


            if (
                req.method === "GET" &&
                req.url === "/"
            ) {

                send(
                    res,
                    200,
                    {
                        name:
                            "Washington FX Backend",
                        status:
                            "online",
                        environment:
                            "simulation"
                    }
                );

                return;
            }


            send(
                res,
                404,
                {
                    error:
                        "Endpoint not found"
                }
            );

        }
    );


server.listen(
    PORT,
    () => {

        console.log(
            `Washington FX backend running on port ${PORT}`
        );

    }
);
