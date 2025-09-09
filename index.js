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

// 管理者グループID（メモリ保存）
let ADMIN_GROUP_ID = "";

// ユーザーごとの「一時的な席選択」を保存（メモリ）
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

// 席ボタンを作成
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

      // 管理者グループ登録
      if (text === "admin set" && event.source.type === "group") {
        ADMIN_GROUP_ID = event.source.groupId;
        await replyMessage(event.replyToken, "✅ このグループを管理者に設定しました");
        continue;
      }

      // 女の子（1対1のトーク想定）
      if (event.source.type === "user") {
        const userId = event.source.userId;

        // 席を選択した場合
        const seats = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];
        if (seats.includes(text)) {
          pendingSeat[userId] = text; // 席を保存
          await replyMessage(event.replyToken, `${text} を選びました。オーダーを入力してください。`);
          continue;
        }

        // 席が保存されていればオーダーとして処理
        if (pendingSeat[userId]) {
          const seat = pendingSeat[userId];
          delete pendingSeat[userId]; // 1回だけ使って削除

          const name = await getDisplayName(userId);

          if (ADMIN_GROUP_ID) {
            await pushMessage(ADMIN_GROUP_ID, `[${seat}] ${name}\n${text}`);
          }
          await replyMessage(event.replyToken, "オーダー承りました。", { items: seatQuickReply().items });
          continue;
        }

        // どの席も選んでなければ、席を選ぶように促す
        await replyMessage(event.replyToken, "席を選んでください。", seatQuickReply());
      }
    }
  }

  res.send("OK");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port 3000");
});
