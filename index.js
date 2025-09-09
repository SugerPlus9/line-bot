import express from "express";
import line from "@line/bot-sdk";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;i2w8g1qQU7mzyBXJRKRcaWexCCdM6h3p3rfp0xXKso9NGxm37c8CQ43vlxDgznmcgg9Hzps0741c2wDNOEqgSRPgfInsrURk4gppVzmQJZBOBgWRZuuep2nbMEo2CUf0Df3oeR1O4wa2k0rssCUhlAdB04t89/1O/w1cDnyilFU=
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;df7721d9a9bcc4f8bf1625df60b2bca5
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID;C913d1bb80352e75d7a89bb0ea871ee7 // ← 環境変数から固定グループを取得

const config = {
  channelAccessToken: LINE_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// 席の一時記憶（ユーザーごとに短時間だけ保持）
const pendingSeat = {};

// LINEに返信
async function replyMessage(replyToken, text, quickReply = null) {
  const message = { type: "text", text };
  if (quickReply) message.quickReply = quickReply;

  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken: replyToken,
      messages: [message],
    },
    { headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` } }
  );
}

// 管理グループにプッシュ送信
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

// ユーザー名取得
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

// 席ボタン
function seatQuickReply() {
  const seats = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];
  return {
    items: seats.map(seat => ({
      type: "action",
      action: { type: "message", label: seat, text: seat }
    }))
  };
}

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim();

      // 女の子（1対1トーク）
      if (event.source.type === "user") {
        const userId = event.source.userId;

        // 席を選択
        const seats = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];
        if (seats.includes(text)) {
          pendingSeat[userId] = text;
          await replyMessage(event.replyToken, `${text} を選びました。オーダーを入力してください。`);
          continue;
        }

        // 席が選択済みならオーダー処理
        if (pendingSeat[userId]) {
          const seat = pendingSeat[userId];
          delete pendingSeat[userId]; // 1回使ったらリセット

          const name = await getDisplayName(userId);

          // 管理グループに送信
          await pushMessage(ADMIN_GROUP_ID, `[${seat}] ${name}\n${text}`);

          // 女の子に返す
          await replyMessage(event.replyToken, "オーダー承りました。", { items: seatQuickReply().items });
          continue;
        }

        // 席が未選択 → 席を促す
        await replyMessage(event.replyToken, "席を選んでください。", seatQuickReply());
      }
    }
  }

  res.send("OK");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port 3000");
});

