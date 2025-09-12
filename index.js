import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// =============================
// 設定
// =============================

// LINE Developers → Messaging API の「チャネルアクセストークン（長期）」
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

// 管理グループID（最初は空、グループ登録で設定される）
let adminGroupId = "";

// =============================
// データ保持（メモリ上）
// =============================
const SEATS = ["T1","T2","T3","T4","T5","T6","V1","V2","V3"];
const pendingSeat = {}; // ユーザーごとの選択席
const userNames = {};   // userId → 登録名
let logs = [];          // 営業ログ

// =============================
// Webhook
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
// QuickReply 席選択
// =============================
function seatQuickReply() {
  return {
    items: SEATS.map(seat => ({
      type: "action",
      action: { type: "message", label: seat, text: seat }
    }))
  };
}

// =============================
// イベント処理
// =============================
async function handleEvent(event) {
  if (event.type !== "message") return;
  const msg = event.message;
  const userId = event.source.userId;

  // ===== 画像（写真） =====
  if (msg.type !== "text") {
    if (event.source.type === "user") {
      const name = await resolveDisplayName(userId);
      logs.push({ userId, text: "写真", displayName: name });

      if (adminGroupId) {
        await pushMessage(adminGroupId, { type: "text", text: `${name} 写真` });
      }

      // ユーザーへの返信（QuickReply付き）
      await replyMessage(event.replyToken, { 
        type: "text", 
        text: "写真承りました。",
        quickReply: seatQuickReply()
      });
    }
    return;
  }

  const text = msg.text.trim();

  // ===== グループ登録 =====
  if (event.source.type === "group" && text === "グループ登録") {
    adminGroupId = event.source.groupId;
    await pushMessage(adminGroupId, { 
      type: "text", 
      text: `✅ 管理グループとして登録しました。\nID: ${adminGroupId}` 
    });
    return;
  }

  // ===== 管理グループでのコマンド =====
  if (event.source.type === "group" && event.source.groupId === adminGroupId) {
    await handleAdminCommand(text);
    return;
  }

  // ===== 女の子からの入力 =====
  if (event.source.type === "user") {
    // 席選択
    if (SEATS.includes(text)) {
      pendingSeat[userId] = text;
      await replyMessage(event.replyToken, { 
        type: "text", 
        text: `${text} 承りました。`,
        quickReply: seatQuickReply()
      });
      if (adminGroupId) await pushMessage(adminGroupId, { type: "text", text: `[席] ${text}` });
      return;
    }

    // オーダー入力
    const seat = pendingSeat[userId];
    const name = await resolveDisplayName(userId);
    logs.push({ userId, text, displayName: name });

    if (adminGroupId) {
      await pushMessage(adminGroupId, { type: "text", text: `${name} ${text}` });
    }

    await replyMessage(event.replyToken, { 
      type: "text", 
      text: "オーダー承りました。",
      quickReply: seatQuickReply()
    });
  }
}

// =============================
// 管理グループコマンド
// =============================
async function handleAdminCommand(text) {
  // 名前登録
  if (text.startsWith("名前登録")) {
    const parts = text.split(" ");
    if (parts.length >= 3) {
      const id = parts[1];
      const name = parts[2];
      userNames[id] = name;
      await pushMessage(adminGroupId, { type: "text", text: