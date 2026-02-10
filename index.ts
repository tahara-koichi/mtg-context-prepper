import { google } from 'googleapis';

// 1. 認証設定 (GitHub Secrets から読み込み)
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}'),
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});

const calendar = google.calendar({ version: 'v3', auth });

async function testCalendarAccess() {
  console.log('📅 カレンダーの自動探索を開始します...');

  try {
    // 1. サービスアカウントに共有されているカレンダーの一覧を取得
    const calendarList = await calendar.calendarList.list();
    
    // 2. サービスアカウント自身のカレンダー以外（共有されたユーザーのカレンダー）を探す
    const sharedCalendar = calendarList.data.items?.find(
      item => item.id !== 'test-266@handy-tiger-487007-n1.iam.gserviceaccount.com'
    );

    if (!sharedCalendar || !sharedCalendar.id) {
      console.log('⚠️ 共有されているカレンダーが見つかりませんでした。');
      console.log('Googleカレンダーの設定で、サービスアカウントのメールアドレスを共有に追加しているか確認してください。');
      return;
    }

    const targetId = sharedCalendar.id;
    console.log(`✅ ターゲットを発見しました: ${targetId} (${sharedCalendar.summary})`);

    // 3. 発見したIDを使って予定を取得
    const now = new Date();
    const res = await calendar.events.list({
      calendarId: targetId, // 自動で見つけたIDを使用
      timeMin: now.toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items || [];
    console.log(`📅 直近の予定を表示します:`);
    events.forEach(event => {
      console.log(`- ${event.start?.dateTime || event.start?.date}: ${event.summary}`);
    });

  } catch (error) {
    console.error('❌ エラー:', error);
  }
}
