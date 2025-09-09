
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 環境変数（LINE Developers で取得）
// =============================
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// =============================
// 固定値（管理グループIDを直書き）
// =============================
const ADMIN_GROUP_ID = "C913d1bb80352e75d7a89bb0ea871ee7"; // あなたの管理グループID
const SEATS = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];
const pendingSeat = {};

// =============================
// Webhook エントリーポイント
// =============================
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.sendStatus(200);

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("handleEvent error:", err);
    }
  }
  res.sendStatus(200);
});

// =============================
// イベント処理
// =============================
async function handleEvent(event) {
  if (event.type !== "message") return;
  const msg = event.message;

  // 個別トーク（女の子）
  if (event.source.type === "user" && msg.type === "text") {
    const userId = event.source.userId;
    const text = msg.text.trim();

    // 席選択
    if (SEATS.includes(text)) {
      pendingSeat[userId] = text;
      await replyMessage(event.replyToken, {
        type: "text",
        text: `${text} を選びました。オーダーを入力してください。`,
      });
      return;
    }

    // 席が選択済みならオーダー処理
    if (pendingSeat[userId]) {
      const seat = pendingSeat[userId];
      delete pendingSeat[userId];

      const name = await getDisplayName(userId);

      // 管理グループに転送
      await pushMessage(ADMIN_GROUP_ID, {
        type: "text",
        text: `[${seat}] ${name}\n${text}`,
      });

      // 女の子に返す
      await replyMessage(event.replyToken, {
        type: "text",
        text: "オーダー承りました。",
        quickReply: {
          items: SEATS.map(seat => ({
            type: "action",
            action: { type: "message", label: seat, text: seat },
          })),
        },
      });
      return;
    }

    // まだ席を選んでない場合
    await replyMessage(event.replyToken, {
      type: "text",
      text: "席を選んでください。",
      quickReply: {
        items: SEATS.map(seat => ({
          type: "action",
          action: { type: "message", label: seat, text: seat },
        })),
      },
    });
  }
}

// =============================
// ユーティリティ
// =============================

// LINEに返信
async function replyMessage(replyToken, message) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const body = JSON.stringify({ replyToken, messages: [message] });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body,
  });
  if (!res.ok) {
    console.error("replyMessage error:", res.status, await res.text());
  }
}

// 管理グループにプッシュ
async function pushMessage(to, message) {
  console.log("pushMessage to:", to);
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({ to, messages: [message] });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body,
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("pushMessage error:", errText);
  }
}

// ユーザー名取得
async function getDisplayName(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    if (!res.ok) return "不明なユーザー";
    const data = await res.json();
    return data.displayName || "不明なユーザー";
  } catch (e) {
    console.error("getDisplayName error:", e);
    return "不明なユーザー";
  }
}

// =============================
// サーバー起動
// =============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
