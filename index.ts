import { google } from 'googleapis';
import * as fs from 'fs'; // ファイル操作（作成・書き込み）を行うためのNode.js組み込みモジュール
import * as path from 'path'; // OS依存（Windows/Unix）のパス区切り文字の違いを吸収し、正規化されたパスを生成するモジュール



// test
// サービスアカウントの認証管理インスタンスを生成。
// Googleの認証ライブラリ google-auth-library を使用
// google-auth-library: Node.js環境でGoogle APIのOAuth 2.0認証
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}'), // JSON Web Token生成に必要な秘密鍵をロード
  scopes: [
    'https://www.googleapis.com/auth/calendar.readonly', // Googleカレンダーの読み取り権限を定義
    'https://www.googleapis.com/auth/drive.readonly', // Googleドライブの読み取り権限を定義
  ],
});

const drive = google.drive({ version: 'v3', auth }); // Google Drive API v3 のリソース操作用オブジェクトを生成
const calendar = google.calendar({ version: 'v3', auth }); // Google Calendar API v3 のリソース操作用オブジェクトを生成

/**
 * 文字列操作（サニタイズ・フォルダ名生成）
 * 絵文字や記号を取り除き、安全な名前にする
 */
function sanitize(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // 絵文字削除
    .replace(/[\\/:*?"<>|]/g, '_') // 禁止記号を置換
    .trim();
}

/**
 * フォルダ名を「ID_案件名」の形式で取得する
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
  // --- 日本時間 (JST) の基準時刻を取得 ---
  const jstNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  console.log(`現在の日本時刻: ${jstNow.toString()}`); // ⚠️ テスト終わったら削除

  // --- 検索範囲の設定 ---
  
  // 【テスト用】今日を同期する場合
  const targetDate = jstNow;  // ⚠️ テスト終わったら削除
  
  /* 【本番用】昨日分を同期する場合は、上の targetDate をコメントアウトして以下を解除
  const yesterday = new Date(jstNow);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = yesterday;
  */

  const timeMin = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0).toISOString();
  const timeMax = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999).toISOString();

  console.log(`検索範囲 (JST): ${timeMin} 〜 ${timeMax}`);

  // 1. 自動化対象のユーザーを探索
  console.log('共有設定済みのユーザーを探索中...');
  const sharedItems = await drive.files.list({ 
    q: "sharedWithMe", // Drive APIの検索クエリ サービスアカウントが権限を持つ全リソースから、共有されたアイテムの親メタデータを逆引き
    fields: "files(owners)" // 不要なメタデータを遮断し、APIレスポンスのペイロードサイズと処理負荷を軽減
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
      console.log(`\n--- 処理開始: ${email} ---`);

       // カレンダー取得
      const res = await calendar.events.list({
        calendarId: email,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = res.data.items || [];
      console.log(`対象期間の予定数: ${events.length}`);

      for (const event of events) {
        const title = event.summary || 'Untitled';
        
        // 主催者チェック
        if (event.organizer?.email !== email) {
          console.log(`⏩ スキップ: ${title} (主催者ではないため)`);
          continue;
        }

        // フォルダ名の決定: 例「0001_ABC株式会社」
        const folderName = getFolderName(title);
        const dir = path.join('meetings', folderName);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const attachments = event.attachments || [];
        for (const att of attachments) {
          if (att.mimeType === 'application/vnd.google-apps.document') {
            try {
              // Googleドキュメントのエクスポート処理、内容をテキストで書き出し
              const driveRes = await drive.files.export({ // Googleドキュメントバイナリとして直接ダウンロードできないため、getではなくexport使用
                fileId: att.fileId!,
                mimeType: 'text/plain',
              });

              // ファイル名: 例「20260210_summary.md」
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
