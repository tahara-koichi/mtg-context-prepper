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
    // 2. カレンダーの予定を取得（今この瞬間から7日間分）
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    const res = await calendar.events.list({
      calendarId: 'washida_m@so-labo.co.jp', // サービスアカウントが権限を持つメインのカレンダー
      timeMin: now.toISOString(),
      timeMax: nextWeek.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items;

    if (!events || events.length === 0) {
      console.log('✅ 接続成功：ただし、予定は見つかりませんでした。');
      return;
    }

    console.log(`✅ 接続成功：直近の予定を ${events.length} 件取得しました:`);
    events.forEach((event, i) => {
      const start = event.start?.dateTime || event.start?.date;
      console.log(`${i + 1}. [${start}] ${event.summary}`);
    });

  } catch (error) {
    console.error('❌ エラーが発生しました:');
    if (error instanceof Error) {
      console.error('メッセージ:', error.message);
      // 認証エラー（鍵が違う、権限がない等）の場合は詳細が表示されます
    }
  }
}

testCalendarAccess();
