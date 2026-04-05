/**
 * シェアスケジュール - Google Apps Script バックエンド
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシートを新規作成し、名前を「Schedule DB」にする
 * 2. このファイルのコードを Apps Script エディタに貼り付ける
 * 3. SPREADSHEET_ID は設定済み（変更不要）
 * 4. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選択
 *    実行するユーザー: 「自分」
 *    アクセスできるユーザー: 「全員」 を選択してデプロイ
 *
 * 【通信方式】
 * - ロード: JSONP (callback パラメータ付き GET)
 * - 保存: フォーム POST (hidden iframe 経由、CORS なし)
 */

// ========== 設定 ==========
const SPREADSHEET_ID = '1MuC1vGyhhJo2j0IJVLXqSsIeoypnptRAtiovGNiOt1E';
const SHEET_NAME = 'data';
const LOCK_TIMEOUT = 10000;

// ========== GET ハンドラ（JSONP対応）==========

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'load';
  const callback = e.parameter && e.parameter.callback;

  let result;
  try {
    if (action === 'load') {
      result = loadData();
    } else if (action === 'ping') {
      result = { ok: true, message: 'pong', time: new Date().toISOString() };
    } else {
      result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.toString() };
  }

  const json = JSON.stringify(result);
  // JSONP: callback パラメータがあればラップして返す
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ========== POST ハンドラ（フォーム POST 対応）==========

function doPost(e) {
  try {
    let stateData;

    // フォーム POST（hidden iframe 経由）→ e.parameter.data に JSON 文字列
    if (e.parameter && e.parameter.data) {
      stateData = JSON.parse(e.parameter.data);
    }
    // JSON POST（直接 fetch）→ e.postData.contents に JSON 文字列
    else if (e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      stateData = body.state || body;
    }

    const result = saveData(stateData);
    const callback = e.parameter && e.parameter.callback;
    const json = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========== データ操作 ==========

function loadData() {
  const sheet = getOrCreateSheet();
  const raw = sheet.getRange('B1').getValue();
  if (!raw) return { ok: true, state: null };
  try {
    return { ok: true, state: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: 'データの読み込みに失敗しました: ' + err.toString() };
  }
}

function saveData(state) {
  if (!state) return { ok: false, error: 'データがありません' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT);
    const sheet = getOrCreateSheet();
    sheet.getRange('B1').setValue(JSON.stringify(state));
    sheet.getRange('C1').setValue(new Date().toISOString());
    sheet.getRange('D1').setValue((sheet.getRange('D1').getValue() || 0) + 1);
    SpreadsheetApp.flush();
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: '保存に失敗しました: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ========== ヘルパー ==========

function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange('A1').setValue('key');
    sheet.getRange('A1:D1').setFontWeight('bold');
    sheet.setColumnWidth(2, 600);
  }
  return sheet;
}

// ========== デバッグ用 ==========

function testLoad() { Logger.log(JSON.stringify(loadData())); }
function testSave() { Logger.log(JSON.stringify(saveData({ test: true }))); }
function clearData() {
  const s = getOrCreateSheet();
  s.getRange('B1').setValue('');
  s.getRange('C1').setValue('');
  s.getRange('D1').setValue(0);
  Logger.log('クリアしました');
}
