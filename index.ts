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
 * 💡 絵文字や記号を取り除き、安全な名前にする
 */
function sanitize(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // 絵文字削除
    .replace(/[\\/:*?"<>|]/g, '_') // 禁止記号を置換
    .trim();
}

/**
 * 💡 フォルダ名を「ID_案件名」の形式で取得する
 */
function getFolderName(title: string): string {
  // タイトルが「0001_案件名 打ち合わせ」のような形式を想定
  const match = title.match(/^(\d{4})[_\s-]?(.+)/);
  if (match) {
    const id = match[1];
    // 空白やアンダースコアで区切って、最初の単語（案件名）だけを抽出
    const rawName = match[2].split(/[\s_]/)[0];
    return `${id}_${sanitize(rawName)}`;
  }
  // IDが見つからない場合はタイトル全体を掃除して使用
  return sanitize(title);
}

async function runActionA() {
  // --- 🕒 日本時間 (JST) の基準時刻を取得 ---
  const jstNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  console.log(`🕒 現在の日本時刻: ${jstNow.toString()}`);

  // --- 📅 検索範囲の設定 ---
  
  // 【テスト用】今日 2/10 を同期する場合
  const targetDate = jstNow; 
  
  /* 【本番用】昨日分を同期する場合は、上の targetDate をコメントアウトしてこちらを解除してください
  const yesterday = new Date(jstNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = yesterday;
  */

  const timeMin = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0).toISOString();
  const timeMax = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999).toISOString();

  console.log(`📅 検索範囲 (JST): ${timeMin} 〜 ${timeMax}`);

  // 1. 自動化対象のユーザーを探索
  console.log('🔍 共有設定済みのユーザーを探索中...');
  const sharedItems = await drive.files.list({ 
    q: "sharedWithMe", 
    fields: "files(owners)" 
  });

  const targetEmails = Array.from(new Set(
    sharedItems.data.files?.flatMap(f => f.owners?.map(o => o.emailAddress))
      .filter((e): e is string => !!e)
  ));

  if (targetEmails.length === 0) {
    console.log('⚠️ 共有されているフォルダ/ファイルが見つかりません。');
    return;
  }

  // 2. 各ユーザーの処理
  for (const email of targetEmails) {
    try {
      console.log(`\n--- 🚀 処理開始: ${email} ---`);
      
      const res = await calendar.events.list({
        calendarId: email,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = res.data.items || [];
      console.log(`📅 対象期間の予定数: ${events.length}`);

      for (const event of events) {
        const title = event.summary || 'Untitled';
        
        // 主催者チェック
        if (event.organizer?.email !== email) {
          console.log(`⏩ スキップ: ${title} (主催者ではないため)`);
          continue;
        }

        // 💡 フォルダ名の決定: 例「0001_ABC株式会社」
        const folderName = getFolderName(title);
        const dir = path.join('meetings', folderName);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const attachments = event.attachments || [];
        for (const att of attachments) {
          if (att.mimeType === 'application/vnd.google-apps.document') {
            try {
              // 内容をテキストで書き出し
              const driveRes = await drive.files.export({
                fileId: att.fileId!,
                mimeType: 'text/plain',
              });

              // 💡 ファイル名: 例「20260210_summary.md」
              const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
              const fileName = `${dateStr}_summary.md`;
              
              fs.writeFileSync(path.join(dir, fileName), driveRes.data as string);
              console.log(`✅ 保存成功: ${dir}/${fileName}`);
            } catch (fileErr: any) {
              console.log(`❌ ファイル取得失敗: ${title} の添付ファイルにアクセスできません。`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ ${email} の処理中にエラーが発生しました: ${err.message}`);
    }
  }
}

// 実行開始
runActionA().catch(console.error);
