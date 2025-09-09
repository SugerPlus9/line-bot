import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 環境変数から取得するもの
// =============================

// LINE Developers → Messaging API設定 にある「チャネルアクセストークン（長期）」
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// LINE Developers → Messaging API設定 にある「チャネルシークレット」
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// =============================
// 固定値（コードに直書きでOKなもの）
// =============================

// 管理者グループID（ログで確認した C93... で始まる文字列）
const ADMIN_GROUP_ID = "C913d1bb80352e75d7a89bb0ea871ee7"; // ← あなたのスクショの groupId をそのまま貼る

// 席一覧
const SEATS = ["T1","T2","T3","T4","T5","T6","V","V1","V2","V3"];

// 一時的な席選択を保持
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

  // 女の子からの1対1トーク
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
      delete pendingSeat[userId]; // 一度使ったらリセット

      const name = await getDisplayName(userId);

      // 管理者グループに転送
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
  const body = JSON.stringify({
    replyToken: replyToken,
    messages: [message],
  });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body: body,
  });
}

// 管理グループにプッシュ
async function pushMessage(to, message) {
  const url = "https://api.line.me/v2/bot/message/push";
  const body = JSON.stringify({
    to: to,
    messages: [message],
  });
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
    body: body,
  });
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
