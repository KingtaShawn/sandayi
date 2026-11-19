'use strict';

const prefix = 'sandayi:replay:';
let warned = false;

function save(record) {
  try {
    wx.setStorageSync(prefix + record.id, record);
    warned = false;
  } catch (error) {
    if (!warned) wx.showModal({ title: '牌谱保存失败', content: '请检查设备存储空间。此前保存的牌谱仍可导出。', showCancel: false });
    warned = true;
  }
}

function exportFile() {
  const fail = () => wx.showToast({ title: '牌谱导出失败', icon: 'none' });
  try {
    const keys = wx.getStorageInfoSync().keys.filter(key => key.startsWith(prefix));
    if (!keys.length) return wx.showToast({ title: '本机还没有牌谱', icon: 'none' });
    const rounds = keys.map(key => wx.getStorageSync(key)).sort((a, b) => a.startedAt - b.startedAt);
    const filePath = wx.env.USER_DATA_PATH + '/sandayi-replays.json';
    wx.getFileSystemManager().writeFile({
      filePath, encoding: 'utf8', data: JSON.stringify({ version: 1, rounds }),
      success: () => wx.shareFileMessage({ filePath, fileName: '三打一本机牌谱.json', fail }),
      fail
    });
  } catch (error) { fail(); }
}

module.exports = { save, exportFile };
