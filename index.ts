import { google } from 'googleapis';
import type { calendar_v3, docs_v1 } from 'googleapis';
import * as fs from 'fs'; // ファイル操作（作成・書き込み）を行うためのNode.js組み込みモジュール
import * as path from 'path'; // OS依存（Windows/Unix）のパス区切り文字の違いを吸収し、正規化されたパスを生成するモジュール



// test
// サービスアカウントの認証管理インスタンスを生成。
// Googleの認証ライブラリ google-auth-library を使用
// google-auth-library: Node.js環境でGoogle APIのOAuth 2.0認証
const serviceAccountPath = process.env.GCP_SERVICE_ACCOUNT_KEY;
const serviceAccountJson = serviceAccountPath
	? fs.readFileSync(serviceAccountPath, 'utf8')
	: '{}';

const auth = new google.auth.GoogleAuth({
	credentials: JSON.parse(serviceAccountJson), // JSON Web Token生成に必要な秘密鍵をロード
	scopes: [
		'https://www.googleapis.com/auth/calendar.readonly', // Googleカレンダーの読み取り権限を定義
		'https://www.googleapis.com/auth/drive.readonly', // Googleドライブの読み取り権限を定義
		'https://www.googleapis.com/auth/documents.readonly', // Googleドキュメントの読み取り権限を定義
	],
});

const drive = google.drive({ version: 'v3', auth }); // Google Drive API v3 のリソース操作用オブジェクトを生成
const calendar = google.calendar({ version: 'v3', auth }); // Google Calendar API v3 のリソース操作用オブジェクトを生成
const docs = google.docs({ version: 'v1', auth }); // Google Docs API v1 のリソース操作用オブジェクトを生成

/**
 * 実行対象のgoogleアカウントを環境変数から取得する。
 * 未設定時は呼び出し側で共有済み全アカウントを対象にする。
 */
function getTargetAccount(): string | null {
	const email = process.env.TARGET_ACCOUNT?.trim();
	return email || null;
}

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
	const id = getMeetingId(title);
	if (id) {
		const namePart = title.replace(new RegExp(`^${id}[_\\s-]?`), '');
		const rawName = namePart.split(/[\s_]/)[0];
		return `${id}_${sanitize(rawName)}`;
	}
	return sanitize(title);
}

/**
 * 先頭から、4桁の数字（ID）を取得
 */
function getMeetingId(title: string): string | null {
	const match = title.match(/^(\d{4})[_\s-]?/);
	return match ? match[1] : null;
}

/**
 * 指定したIDで始まるフォルダが既に存在するか確認する
 * @param baseDir meetings
 * @param meetingId 検索するID (0001)
 * @returns 見つかったフォルダのフルパス (meetings/0001_xxx)、なければ null
 */
function findExistingMeetingFolder(baseDir: string, meetingId: string): string | null {
	if (!fs.existsSync(baseDir)) return null;

	try {
		const entries = fs.readdirSync(baseDir, { withFileTypes: true });
		const found = entries.find(entry => 
			entry.isDirectory() && entry.name.startsWith(`${meetingId}_`)
		);
		return found ? path.join(baseDir, found.name) : null;
	} catch (e) {
		return null;
	}
}

/**
 * 予定の時刻をJSTで「HH:mm - HH:mm」の形式にフォーマットする
 * 
 * @param start 
 * @param end 
 * @returns 
 */
function formatJstTimeRange(start?: string | null, end?: string | null): string | null {
	if (!start || !end) return null;
	const fmt = new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	const startStr = fmt.format(new Date(start));
	const endStr = fmt.format(new Date(end));
	return `${startStr} - ${endStr}`;
}

/**
 * 最新の日付のサマリーファイルを探す
 * @param dir 
 * @param targetDate 
 * @returns 
 */
function getPreviousSummaryPath(dir: string, targetDate: Date): string | null {
	if (!fs.existsSync(dir)) return null;
	const targetDateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
	const files: string[] = fs.readdirSync(dir);
	const candidates = files
		.map((name) => {
			const match = name.match(/^(\d{8})_summary\.md$/);
			if (!match) return null;
			const dateStr = match[1];
			if (dateStr >= targetDateStr) return null;
			return { name, dateStr };
		})
		.filter((v): v is { name: string; dateStr: string } => v !== null)
		.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
	if (candidates.length === 0) return null;
	const last = candidates[candidates.length - 1];
	return path.join(dir, last.name);
}

/**
 * GoogleDocumentの構造化された内容からテキストを抽出する
 * @param content 
 * @returns 
 */
function extractTextFromContent(content?: docs_v1.Schema$StructuralElement[]): string {
	if (!content) return '';
	let result = '';
	for (const el of content) {
		const paragraph = el.paragraph;
		if (!paragraph?.elements) continue;
		for (const pe of paragraph.elements) {
			const textRun = pe.textRun?.content;
			if (textRun) result += textRun;
		}
	}
	return result;
}

/**
 * 「メモ」タブを抽出
 * 「メモ」タブがない場合は全体のテキストを抽出
 * @param document 
 * @returns 
 */
function extractMemoText(document: docs_v1.Schema$Document): string | null {
	const tabs = document.tabs;
	if (!tabs || tabs.length === 0) {
		return extractTextFromContent(document.body?.content);
	}

	const memoTab = tabs.find(
		(t) => (t.tabProperties?.title || '').trim() === 'メモ'
	);
	if (memoTab?.documentTab) {
		return extractTextFromContent(memoTab.documentTab.body?.content);
	}

	let allText = '';
	for (const tab of tabs) {
		if (tab.documentTab?.body?.content) {
			allText += extractTextFromContent(tab.documentTab.body.content);
		}
	}
	return allText;
}

/**
 * カレンダーの添付Googleドキュメントを取得し、メモ（なければ全文）をサマリーファイルとして保存する
 * @param event 
 * @param dir 
 * @param targetDate 
 */
async function saveMeetingDocuments(
	event: calendar_v3.Schema$Event,
	dir: string,
	targetDate: Date
): Promise<void> {
	const attachments = event.attachments || [];
	for (const att of attachments) {
		if (att.mimeType === 'application/vnd.google-apps.document') {
			try {
				// ファイル名を生成
				const dateStr = targetDate.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
				const fileName = `${dateStr}_summary.md`;

				const fullPath = path.join(dir, fileName);

				// ファイルが存在するかチェック
				if (fs.existsSync(fullPath)) {
					console.log(`⏩ ファイル保存スキップ: ${fullPath} (既に存在するため)`);
					continue; 
				}
				
				let docRes: { data: docs_v1.Schema$Document };
				try {
					docRes = await docs.documents.get({
						documentId: att.fileId!,
						includeTabsContent: true,
					});
				} catch {
					docRes = await docs.documents.get({
						documentId: att.fileId!,
					});
				}

				const memoText = extractMemoText(docRes.data);
				if (memoText === null) {
					console.log(`⏩ メモ取得失敗: ${event.summary || 'Untitled'}`);
					continue;
				}
				if (memoText.trim().length === 0) {
					console.log(`ℹ️ メモタブなしのため全体取得: ${event.summary || 'Untitled'}`);
				}

				// フォルダ作成
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
					console.log(`📂 新規フォルダ作成: ${dir}`);
				} else {
					console.log(`⏩ フォルダ作成スキップ: ${dir} (既に存在するため)`);
				}

				// ファイル書き込み
				fs.writeFileSync(path.join(dir, fileName), memoText);
				console.log(`✅ 保存成功: ${dir}/${fileName}`);
			} catch (fileErr: any) {
				const status = fileErr?.response?.status ?? fileErr?.code ?? 'unknown';
				const message = fileErr?.response?.data?.error?.message ?? fileErr?.message ?? 'unknown error';
				console.log(
					`❌ ファイル取得失敗: ${event.summary || 'Untitled'} の添付ファイルにアクセスできません。` +
					` (status: ${status}, message: ${message})`
				);
			}
		}
	}
}

/**
 * 添付ファイルからGoogleドキュメントのURLを取得する
 */
function getMemoUrl(event: calendar_v3.Schema$Event): string | null {
    if (!event.attachments) return null;
    // Googleドキュメントを優先して探す
    const doc = event.attachments.find(att => att.mimeType === 'application/vnd.google-apps.document');
    if (doc && doc.fileUrl) return doc.fileUrl;
    
    // なければ最初のファイルのURL
    if (event.attachments.length > 0 && event.attachments[0].fileUrl) {
        return event.attachments[0].fileUrl;
    }
    return null;
}

/**
 * 翌日タスクJSONの本体を構築する
 * @param tomorrow
 * @param folderName
 * @param previousSummaryPath
 * @param tomorrowEvent
 * @returns
 */
function buildTomorrowTask(
	tomorrow: Date,
	folderName: string,
	previousSummaryPath: string | null,
	tomorrowEvent: calendar_v3.Schema$Event,
	yesterdayEvent: calendar_v3.Schema$Event
) {
const tomorrowTitle = tomorrowEvent.summary || 'Untitled';
const tomorrowScheduledTime = formatJstTimeRange(
	tomorrowEvent.start?.dateTime,
	tomorrowEvent.end?.dateTime
);

const prevTitle = yesterdayEvent.summary || 'Untitled';
const prevMemoUrl = getMemoUrl(yesterdayEvent);

return {
	target_date: tomorrow.toISOString().split('T')[0],
	meeting_info: {
		title: tomorrowTitle,
		folder_name: folderName,
		calendar_event_id: tomorrowEvent.id || '',
		scheduled_time: tomorrowScheduledTime || ''
	},
	previous_meeting_info: {
      title: prevTitle,
      memo_url: prevMemoUrl || '',
      calendar_event_id: yesterdayEvent.id || '',
    },
	context_files: {
		previous_summary: previousSummaryPath,
	},
	// 一旦増永さんに共有をもらった内容で実装
	instructions: [
		'previous_summaryから議論すべき重要トピックを3点特定せよ',
		'明日のアジェンダ案を作成し、Google Chat用のMarkdown形式で出力せよ'
	],
};
}

/**
 * 翌日タスクJSONをinbox配下に書き込む
 * @param inboxDir
 * @param folderName
 * @param tomorrow
 * @param tomorrowTask
 */
function writeTomorrowTaskFile(
	inboxDir: string,
	folderName: string,
	tomorrow: Date,
	tomorrowTask: ReturnType<typeof buildTomorrowTask>
): void {
	const todayJst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
	const todayDateStr = todayJst.toISOString().split('T')[0].replace(/-/g, '');
	const tomorrowFileName = `${todayDateStr}_${folderName}_tomorrow_task.json`;
	const tomorrowPath = path.join(inboxDir, tomorrowFileName);
	fs.writeFileSync(tomorrowPath, JSON.stringify(tomorrowTask, null, 2));
	console.log(`✅ 翌日タスク作成: ${tomorrowPath}`);
}

/**
 * カレンダー/ドライブから情報を取得し、翌日タスクを生成する
 */
async function runActionA() {
	// --- 日本時間 (JST) の基準時刻を取得 ---
	const jstNow = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
	console.log(`現在の日本時刻: ${jstNow.toString()}`); // ⚠️ テスト終わったら削除

	// --- 検索範囲の設定 ---

	// 【本番用】昨日分を同期
	const yesterday = new Date(jstNow);
	yesterday.setDate(yesterday.getDate() - 1);
	const targetDate = yesterday;

	const timeMin = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0).toISOString();
	const timeMax = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999).toISOString();
	const tomorrow = new Date(targetDate);
	tomorrow.setDate(tomorrow.getDate() + 2);
	const tomorrowMin = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0, 0).toISOString();
	const tomorrowMax = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999).toISOString();

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

	const targetAccount = getTargetAccount();
	const emailsToProcess = targetAccount
		? targetEmails.filter((email) => email === targetAccount)
		: targetEmails;

	if (targetAccount && emailsToProcess.length === 0) {
		console.log(`⚠️ TARGET_ACCOUNT に指定されたユーザーが共有一覧に見つかりません: ${targetAccount}`);
		return;
	}

	// 2. 各ユーザーの処理
	for (const email of emailsToProcess) {
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

			const tomorrowRes = await calendar.events.list({
				calendarId: email,
				timeMin: tomorrowMin,
				timeMax: tomorrowMax,
				singleEvents: true,
				orderBy: 'startTime',
			});

			const tomorrowEvents = (tomorrowRes.data.items || []) as calendar_v3.Schema$Event[];
			const tomorrowEventById = new Map(
				tomorrowEvents
				.map((e) => (e.summary ? [getMeetingId(e.summary), e] as const : [null, e] as const))
				.filter((pair): pair is [string, typeof tomorrowEvents[number]] => !!pair[0])
			);

			const events = res.data.items || [];
			console.log(`対象期間の予定数: ${events.length}`);

			for (const event of events) {
				const title = event.summary || 'Untitled';
				
				// 主催者チェック
				if (event.organizer?.email !== email) {
					console.log(`⏩ スキップ: ${title} (主催者ではないため)`);
					continue;
				}

				let folderName = getFolderName(title);
				const meetingId = getMeetingId(title);
				if (meetingId) {
					// meetingsフォルダ内を検索
					const existingPath = findExistingMeetingFolder('meetings', meetingId);
					if (existingPath) {
						folderName = path.basename(existingPath); 
						console.log(`📂 meetings配下にフォルダ作成済み: ${folderName}`);
					} else {
						console.log(`📁 meetings配下にフォルダ未作成: ${folderName}`);
					}
				}

				const dir = path.join('meetings', folderName);
				const inboxDir = 'inbox';

				if (!fs.existsSync(inboxDir)) {
					fs.mkdirSync(inboxDir, { recursive: true });
				}

				await saveMeetingDocuments(event, dir, targetDate);

				const previousSummaryPath = getPreviousSummaryPath(dir, tomorrow);
				const tomorrowEvent = meetingId ? tomorrowEventById.get(meetingId) : undefined;
				if (tomorrowEvent) {
					const tomorrowTask = buildTomorrowTask(
						tomorrow,
						folderName,
						previousSummaryPath,
						tomorrowEvent,
						event
					);
					writeTomorrowTaskFile(inboxDir, folderName, tomorrow, tomorrowTask);
				}
			}
		} catch (err: any) {
			console.error(`❌ ${email} の処理中にエラーが発生しました: ${err.message}`);
		}
	}
}

// 実行開始
runActionA().catch(console.error);
