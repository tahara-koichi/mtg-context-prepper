// ... (認証部分はそのまま)

async function runActionA() {
  console.log('🔍 自動化対象のユーザーを探索中...');
  // (ユーザー探索部分はそのまま)
  const sharedItems = await drive.files.list({ q: "sharedWithMe", fields: "files(owners)" });
  const targetEmails = Array.from(new Set(sharedItems.data.files?.flatMap(f => f.owners?.map(o => o.emailAddress)).filter((e): e is string => !!e)));

  if (targetEmails.length === 0) return console.log('⚠️ 共有アイテムなし');

  // --- 🕒 時間設定（テスト用：今日 2/10 に変更） ---
  const targetDate = new Date(); // 今日の日付 (2/10)
  
  /* 本番用（昨日分）は一時コメントアウト
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = yesterday;
  */

  const timeMin = new Date(targetDate.setHours(0, 0, 0, 0)).toISOString();
  const timeMax = new Date(targetDate.setHours(23, 59, 59, 999)).toISOString();

  console.log(`📅 テスト実行中: ${timeMin} 〜 ${timeMax} の予定をチェックします`);

  for (const email of targetEmails) {
    try {
      console.log(`\n--- 🚀 Action A (テスト) 開始: ${email} ---`);
      const res = await calendar.events.list({ 
        calendarId: email, 
        timeMin, 
        timeMax, 
        singleEvents: true,
        orderBy: 'startTime' 
      });
      const events = res.data.items || [];
      console.log(`📅 見つかった予定数: ${events.length}`);

      for (const event of events) {
        const title = event.summary || 'Untitled';
        
        // 💡 主催者チェック（自分が主催者のものだけ処理）
        if (event.organizer?.email !== email) {
          console.log(`⏩ スキップ: ${title} (主催者ではないため)`);
          continue;
        }

        const caseIdMatch = title.match(/^\d{4}/);
        const folderName = caseIdMatch ? caseIdMatch[0] : sanitize(title);
        const dir = path.join('meetings', folderName);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const attachments = event.attachments || [];
        for (const att of attachments) {
          if (att.mimeType === 'application/vnd.google-apps.document') {
            try {
              const fileMetadata = await drive.files.get({ fileId: att.fileId!, fields: 'name' });
              const realFileName = fileMetadata.data.name || att.title;
              
              const driveRes = await drive.files.export({ fileId: att.fileId!, mimeType: 'text/plain' });

              // ファイル名の先頭日付は実行日の日付 (20260210)
              const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
              const safeFileName = `${dateStr}_${sanitize(realFileName)}.md`;
              
              fs.writeFileSync(path.join(dir, safeFileName), driveRes.data as string);
              console.log(`✅ 保存成功: ${dir}/${safeFileName}`);
            } catch (fileErr) {
              console.log(`❌ ファイル取得失敗: 権限不足の可能性があります (ID: ${att.fileId})`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ エラー詳細: ${err.message}`);
    }
  }
}

// 実行
runActionA().catch(console.error);
