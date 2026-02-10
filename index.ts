import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}'),
  scopes: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
});

const drive = google.drive({ version: 'v3', auth });
const calendar = google.calendar({ version: 'v3', auth });

async function runAutoSync() {
  console.log('🔍 自動化対象のユーザーを探索中...');

  // 1. 自分に共有されているアイテムを検索して、所有者のメルアドを抽出
  const sharedItems = await drive.files.list({
    q: "sharedWithMe",
    fields: "files(owners)",
  });

  const targetEmails = Array.from(new Set(
    sharedItems.data.files?.flatMap(f => f.owners?.map(o => o.emailAddress))
      .filter((email): email is string => !!email)
  ));

  if (targetEmails.length === 0) {
    console.log('⚠️ 共有されているアイテムがありません。ユーザーがフォルダを共有する必要があります');
    return;
  }

  console.log(`✅ ${targetEmails.length} 名のユーザーを自動検知しました: ${targetEmails.join(', ')}`);

  // 2. 検知したユーザーごとに処理を実行
  for (const email of targetEmails) {
    try {
      console.log(`\n--- 🚀 Processing: ${email} ---`);
      
      // ここで各ユーザーのカレンダーを読み取る
      const res = await calendar.events.list({
        calendarId: email,
        timeMin: new Date(new Date().setHours(0,0,0,0)).toISOString(),
        singleEvents: true,
      });

      console.log(`📅 今日の予定数: ${res.data.items?.length || 0}`);
      
      // TODO: ここに昨日分の要約保存（Action A）や、明日の指示書作成（Action B）のロジックを組み込む
      // 各ユーザーごとにフォルダを分けて保存する処理が必要になります

    } catch (err) {
      console.log(`❌ ${email} の処理に失敗しました。カレンダーの共有設定が未完了の可能性があります。`);
    }
  }
}

runAutoSync();
