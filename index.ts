import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

// 1. 認証設定
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}'),
  scopes: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
});

const drive = google.drive({ version: 'v3', auth });
const calendar = google.calendar({ version: 'v3', auth });

/**
 * 【一括同期 (Action A)】
 * 前日の会議データを取得し、フォルダ別に要約を保存する
 */
async function runActionA() {
  console.log('🔍 自動化対象のユーザー（共有設定済み）を探索中...');

  const sharedItems = await drive.files.list({
    q: "sharedWithMe",
    fields: "files(owners)",
  });

  const targetEmails = Array.from(new Set(
    sharedItems.data.files?.flatMap(f => f.owners?.map(o => o.emailAddress))
      .filter((email): email is string => !!email)
  ));

  if (targetEmails.length === 0) {
    console.log('⚠️ 対象ユーザーが見つかりません。ドライブの共有設定を確認してください。');
    return;
  }

  // 2. 「昨日」の時間範囲を設定
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const timeMin = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
  const timeMax = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();

  for (const email of targetEmails) {
    try {
      console.log(`\n--- 🚀 Action A (昨日分同期) 開始: ${email} ---`);
      
      const res = await calendar.events.list({
        calendarId: email,
        timeMin,
        timeMax,
        singleEvents: true,
      });

      const events = res.data.items || [];
      console.log(`📅 昨日の予定数: ${events.length}`);

      for (const event of events) {
        const title = event.summary || 'Untitled';
        
        // 💡 仕様：タイトル先頭4桁からフォルダ名を特定
        const caseIdMatch = title.match(/^\d{4}/);
        const folderName = caseIdMatch ? caseIdMatch[0] : title.replace(/[\\/:*?"<>|]/g, '');
        const dir = path.join('meetings', folderName);

        // フォルダがなければ作成
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const attachments = event.attachments || [];
        for (const att of attachments) {
          if (att.mimeType === 'application/vnd.google-apps.document') {
            console.log(`📄 要約ドキュメントを発見: ${att.title}`);

            const driveRes = await drive.files.export({
              fileId: att.fileId!,
              mimeType: 'text/plain',
            });

            // 保存ファイル名: YYYYMMDD_summary.md
            const dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
            const filePath = path.join(dir, `${dateStr}_summary.md`);

            fs.writeFileSync(filePath, driveRes.data as string);
            console.log(`✅ 保存完了: ${filePath}`);
          }
        }
      }
    } catch (err) {
      console.log(`❌ ${email} の処理中にエラーが発生しました。`);
    }
  }
}

// 💡 エラーの元だった箇所：関数名を runActionA に合わせました！
runActionA().catch(console.error);
