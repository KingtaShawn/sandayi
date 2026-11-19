// 牌谱与待上传任务在同一事务中保存，写入云端成功后才删除任务。
(function () {
  'use strict';
  let opening, syncing, retryTimer, currentDeal, delay = 5000;
  let status = '';
  const pageId = window.crypto.randomUUID?.() || String(Date.now()) + Math.random();
  const lockName = id => 'sandayi-replay-page:' + id;
  let pageLock;
  function keepPageLock() {
    if (!navigator.locks) return Promise.resolve(false);
    if (!pageLock) pageLock = new Promise((resolve, reject) => {
      navigator.locks.request(lockName(pageId), () => {
        resolve(true);
        // 浏览器销毁页面会自动释放，其他页面随后可安全收尾本页留下的牌局。
        return new Promise(() => {});
      }).catch(reject);
    });
    return pageLock;
  }
  const owner = () => window.Cloud?.uid() || '';
  const setting = uid => 'sandayi:upload-replays:' + uid;
  function enabled(uid) {
    try { return !!uid && localStorage.getItem(setting(uid)) === 'on'; }
    catch { return false; }
  }

  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('sandayi-replays', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('rounds')) db.createObjectStore('rounds', { keyPath: 'id' });
        db.createObjectStore('unfinished', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner');
        db.createObjectStore('pending', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transact(names, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const request = operation(tx);
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = () => reject(tx.error || new Error('牌谱读写中断'));
    });
  }
  function showStatus(message) {
    status = message;
    window.dispatchEvent(new Event('replay-sync'));
  }
  async function recoverClosedPages(uid) {
    if (!navigator.locks) return;
    const items = await transact('unfinished', 'readonly', tx => tx.objectStore('unfinished').index('owner').getAll(uid));
    for (const item of items) {
      if (item.page === pageId) continue;
      await navigator.locks.request(lockName(item.page), { ifAvailable: true }, async lock => {
        if (!lock || !enabled(uid) || uid !== owner()) return;
        // 在同一事务里重读标记，多个标签页恢复同一局时只入队一次。
        await transact(['rounds', 'unfinished', 'pending'], 'readwrite', tx => {
          const stages = tx.objectStore('unfinished');
          const key = [uid, item.id];
          const check = stages.get(key);
          check.onsuccess = () => {
            if (!check.result) return;
            const request = tx.objectStore('rounds').get(item.id);
            request.onsuccess = () => {
              if (request.result) tx.objectStore('pending').put({ owner: uid, id: item.id, round: request.result });
              stages.delete(key);
            };
          };
        });
      });
    }
  }
  async function drain() {
    const uid = owner();
    if (enabled(uid)) await recoverClosedPages(uid);
    while (enabled(uid) && uid === owner()) {
      const job = await transact('pending', 'readonly', tx => tx.objectStore('pending').index('owner').get(uid));
      if (!job || !enabled(uid) || uid !== owner()) return;
      const result = await Cloud.replayRequest(uid, 'PUT', job.round);
      if (result.id !== job.id) throw new Error('未确认上传');
      await transact('pending', 'readwrite', tx => tx.objectStore('pending').delete([uid, job.id]));
      if (owner() === uid) showStatus('已上传最近一副牌谱');
      delay = 5000;
    }
  }
  function schedule(ms = 0) {
    clearTimeout(retryTimer);
    if (!enabled(owner())) return;
    retryTimer = setTimeout(() => {
      if (syncing) { schedule(1000); return; }
      syncing = drain().catch(error => {
        console.warn('牌谱上传待重试', error.message);
        showStatus('牌谱待上传，联网后自动重试');
        schedule(delay);
        delay = Math.min(60000, delay * 2);
      }).finally(() => { syncing = null; });
    }, ms);
  }
  async function write(record, uid, closed) {
    const staged = uid && !closed && await keepPageLock();
    const stores = uid ? ['rounds', 'unfinished', 'pending'] : ['rounds'];
    await transact(stores, 'readwrite', tx => {
      tx.objectStore('rounds').put(record);
      if (staged) tx.objectStore('unfinished').put({ owner: uid, id: record.id, page: pageId });
      if (uid && closed) {
        tx.objectStore('unfinished').delete([uid, record.id]);
        tx.objectStore('pending').put({ owner: uid, id: record.id, round: record });
      }
    });
    if (uid && closed) schedule();
  }
  let lastWrite = Promise.resolve();
  function persist(record, uid, closed) {
    const saved = lastWrite.then(() => write(record, uid, closed));
    lastWrite = saved.catch(() => {});
    return saved;
  }
  window.RoundArchive = {
    save(record) {
      if (currentDeal?.id !== record.id) {
        const uid = owner();
        currentDeal = { id: record.id, owner: enabled(uid) ? uid : '' };
      }
      const closed = !!record.settlement || record.phase === 'INIT_DEAL';
      return persist(record, currentDeal.owner, closed);
    },
    // 手动重发：保留截至确认重发之前的部分牌谱。
    finish(record) {
      if (record && currentDeal?.id === record.id && !record.settlement) return persist(record, currentDeal.owner, true);
      return Promise.resolve();
    },
    all() { return transact('rounds', 'readonly', tx => tx.objectStore('rounds').getAll()); },
    enabled() { return enabled(owner()); },
    setEnabled(value) {
      const uid = owner();
      if (!uid) throw new Error('请先连接云账号');
      localStorage.setItem(setting(uid), value ? 'on' : 'off');
      showStatus('');
      schedule();
    },
    accountChanged() { showStatus(''); schedule(); },
    status() { return status; }
  };
  window.addEventListener('online', () => schedule());
})();
