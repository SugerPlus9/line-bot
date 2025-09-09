import express from "express";
import line from "@line/bot-sdk";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const config = {
  channelAccessToken: LINE_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// 管理者グループIDを保存
let ADMIN_GROUP_ID = "";

// LINEに返信
async function replyMessage(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken: replyToken,
      messages: [{ type: "text", text: text }],
    },
    { headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` } }
  );
}

// LINEにプッシュ送信
async function pushMessage(to, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to: to,
      messages: [{ type: "text", text: text }],
    },
    { headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` } }
  );
}

// ユーザー名を取得
async function getDisplayName(userId) {
  try {
    const res = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    return res.data.displayName || "不明なユーザー";
  } catch (e) {
    console.error("getDisplayName error:", e.message);
    return "不明なユーザー";
  }
}

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim();

      // 管理者グループの登録
      if (text === "admin set" && event.source.type === "group") {
        ADMIN_GROUP_ID = event.source.groupId;
        await replyMessage(event.replyToken, "✅ このグループを管理者に設定しました");
        continue;
      }

      // 管理者グループに転送（ユーザーからのDM）
      if (ADMIN_GROUP_ID && event.source.type === "user") {
        const name = await getDisplayName(event.source.userId);
        await pushMessage(ADMIN_GROUP_ID, `[${name}] ${text}`);
        await replyMessage(event.replyToken, "オーダーを承りました。");
      } else {
        await replyMessage(event.replyToken, `受け取りました: ${text}`);
      }
    }
  }

  res.send("OK");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port 3000");
});

