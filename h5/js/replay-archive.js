// 每副牌单独写入当前站点的 IndexedDB，后来的对局不会覆盖它。
(function () {
  'use strict';
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('sandayi-replays', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('rounds', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => { opening = null; throw error; });
    return opening;
  }

  async function transact(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('rounds', mode);
      const request = operation(tx.objectStore('rounds'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('牌谱读写中断'));
    });
  }

  window.RoundArchive = {
    save(record) { return transact('readwrite', store => store.put(record)); },
    all() { return transact('readonly', store => store.getAll()); }
  };
})();
