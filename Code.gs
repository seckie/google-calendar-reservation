// =============================================
// 予約システム - Google Apps Script バックエンド
// =============================================

const SETTINGS_SHEET = '設定';
const BOOKINGS_SHEET = '予約';

// ウェブアプリのエントリポイント
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('予約システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 設定シートの内容をオブジェクトとして返す
function getSettings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  const data = sheet.getDataRange().getValues();
  const settings = {};
  data.forEach(([key, value]) => { if (key) settings[key] = value; });
  return settings;
}

// 予約可能な日付一覧を返す（今日の翌日〜N日後）
function getAvailableDates() {
  const settings = getSettings();
  const daysAhead = Number(settings['予約可能日数']) || 30;
  const availableDays = String(settings['予約可能曜日'] || '1,2,3,4,5')
    .split(',').map(d => Number(d.trim()));

  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    if (availableDays.includes(d.getDay())) {
      dates.push(formatDate(d));
    }
  }
  return dates;
}

// 指定日の全スロットと予約状況を返す
function getSlots(dateStr) {
  const settings = getSettings();
  const [startH, startM] = String(settings['開始時間'] || '10:00').split(':').map(Number);
  const [endH, endM]     = String(settings['終了時間']  || '17:00').split(':').map(Number);
  const duration = Number(settings['枠時間(分)']) || 60;

  const slots = [];
  let cur = startH * 60 + startM;
  const end = endH * 60 + endM;

  while (cur + duration <= end) {
    slots.push(pad(Math.floor(cur / 60)) + ':' + pad(cur % 60));
    cur += duration;
  }

  const booked = getBookedSlots(dateStr);
  return slots.map(t => ({ time: t, available: !booked.includes(t) }));
}

// 指定日に予約済みの時間帯を返す（キャンセルを除く）
function getBookedSlots(dateStr) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKINGS_SHEET);
  const data = sheet.getDataRange().getValues();
  // ヘッダー行をスキップ。列順: [予約ID, 日付, 時間, 名前, メール, 予約日時, ステータス]
  return data.slice(1)
    .filter(r => r[1] === dateStr && r[6] !== 'キャンセル')
    .map(r => r[2]);
}

// 予約を作成する（LockService による二重予約防止）
function createBooking(name, email, dateStr, timeStr) {
  // ロック取得（最大15秒待機）
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { success: false, message: 'サーバーが混み合っています。しばらくしてから再度お試しください。' };
  }

  try {
    // ロック内で再チェック（二重予約防止）
    if (getBookedSlots(dateStr).includes(timeStr)) {
      return { success: false, message: 'この時間帯はすでに予約済みです。別の時間帯をお選びください。' };
    }

    const id = Utilities.getUuid().substring(0, 8).toUpperCase();
    const settings = getSettings();

    // スプレッドシートに記録
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKINGS_SHEET);
    sheet.appendRow([id, dateStr, timeStr, name, email, new Date(), '確定']);

    // Google Calendar にイベント追加
    const calendarId = settings['カレンダーID'];
    if (calendarId) {
      try {
        const cal = CalendarApp.getCalendarById(String(calendarId));
        const [y, mo, d] = dateStr.split('-').map(Number);
        const [h, m]     = timeStr.split(':').map(Number);
        const duration   = Number(settings['枠時間(分)']) || 60;
        const start = new Date(y, mo - 1, d, h, m);
        const end   = new Date(start.getTime() + duration * 60000);
        cal.createEvent(`[予約] ${name}`, start, end, {
          description: `予約ID: ${id}\nメール: ${email}`
        });
      } catch (calErr) {
        // カレンダーエラーは非致命的（予約自体は成立させる）
        console.error('Calendar error:', calErr.message);
      }
    }

    // 予約確認メール送信
    try {
      const duration = Number(settings['枠時間(分)']) || 60;
      GmailApp.sendEmail(
        email,
        `【予約確認】${dateStr} ${timeStr}`,
        `${name} 様\n\n` +
        `予約を受け付けました。\n\n` +
        `■ 日時: ${dateStr} ${timeStr}〜（${duration}分）\n` +
        `■ 予約ID: ${id}\n\n` +
        `ご不明な点はお問い合わせください。`
      );
    } catch (mailErr) {
      console.error('Mail error:', mailErr.message);
    }

    return { success: true, message: '予約が完了しました。確認メールをお送りしました。', id };

  } catch (e) {
    console.error('Booking error:', e.message);
    return { success: false, message: 'エラーが発生しました: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// ユーティリティ
function formatDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function pad(n) {
  return String(n).padStart(2, '0');
}
