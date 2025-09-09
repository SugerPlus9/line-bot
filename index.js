import express from "express";
import line from "@line/bot-sdk";

const app = express();

// LINEの設定（環境変数から読み込む）
const config = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

// Webhookエンドポイント
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// メッセージを受け取ったときの処理（テスト用オウム返し）
function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "受け取りました: " + event.message.text
  });
}

// サーバー起動
app.listen(process.env.PORT || 3000, () => {
  console.log("Server is running.");
});
