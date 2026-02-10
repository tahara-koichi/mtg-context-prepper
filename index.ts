import { google } from 'googleapis';

// 1. 認証設定 (GitHub Secrets から読み込み)
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}'),
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});

const calendar = google.calendar({ version: 'v3', auth });

async function testCalendarAccess() {
  console.log('📅 Googleカレンダーへの接続テストを開始します...');

  try {
    // 2. カレンダーの予定を取得（今日から1週間分）
    const res = await calendar.events.list({
      calendarId:
