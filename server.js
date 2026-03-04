const express = require("express");
const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/", (_, res) => res.status(200).send("OK"));

app.post("/tv/webhook", (req, res) => {
  const body = req.body || {};

  // Protect endpoint with a simple key (sent inside JSON)
  if (!body.key || body.key !== process.env.USER_KEY) {
    return res.status(401).json({ ok: false, error: "bad key" });
  }

  console.log("TV EVENT:", JSON.stringify(body));
  return res.status(200).json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
