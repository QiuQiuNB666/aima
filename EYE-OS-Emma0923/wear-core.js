// A preparation checklist, never a physical interlock or motor permission.
export const WEAR_ITEMS = Object.freeze({
  common: ['area','stop'],
  legs: ['leg-fit','leg-left','leg-right'],
  hands: ['hand-fit','hand-release','hand-support','hand-grip'],
  dual: ['dual-roles','dual-clearance'],
});
export const WEAR_GUIDES = Object.freeze({
  'single-legs': ['按设备说明固定腰部与左右腿绑带，确认没有夹压和滑移。', '在设备页检查腿部连接，再由腿部游戏完成该设备的中位与步态校准。', '在已确认的玩法中小幅踏步，检查画面前进与停止是否符合动作；不对劲就暂停。'],
  'single-hands': ['托稳两根支撑杆，再按已确认的方式解除腿部绑带；腰部固定保持有效。', '确认左右握持和失力支撑，按下方流程记录舒适中位、后拉与前推位置。', '靶场：左杆控制左枪，右杆控制右枪；挖掘机：左杆控制动臂，右杆控制铲斗。先逐侧试，再一起试。'],
  dual: ['先分别核对两套设备：腿部套保持腿带固定；手部套解除腿带、保留腰部固定并托稳双杆。', '分别检查两套连接和校准，先只测试腿部，再只测试左右操作杆，确认没有串线或杆件干涉。', '两侧独立测试通过后，再进入联动测试。本页只提供双杆画面试玩；真机协同由本机集成程序接入。'],
});
export function wearRoles(layout) {
  if (!Object.hasOwn(WEAR_GUIDES, layout)) throw new Error('Unknown wear layout');
  return layout === 'dual' ? ['legs','hands'] : [layout === 'single-legs' ? 'legs' : 'hands'];
}
export function wearItems(layout) {
  return [...WEAR_ITEMS.common, ...wearRoles(layout).flatMap(role => WEAR_ITEMS[role]), ...(layout === 'dual' ? WEAR_ITEMS.dual : [])];
}

export function createWearCheck(initial = 'single-hands') {
  let layout, checked, approved, device, binding, reason;
  function reset(next = layout) {
    wearRoles(next); layout=next; checked=new Set(); approved=false; device=null; binding=null; reason='';
  }
  reset(initial);
  function confirmItem(id, value) {
    if (!wearItems(layout).includes(id) || typeof value !== 'boolean') return false;
    if (value) checked.add(id); else checked.delete(id);
    approved=false; reason=''; return true;
  }
  function invalidate(message = '请重新确认本次自查') { approved=false; reason=message; }
  function clearDevice(message) { device=null; invalidate(message); }
  function ingest(report, now) {
    const stamp = typeof report?.checkedAt === 'string' ? Date.parse(report.checkedAt) : NaN;
    if (report?.schema !== 'aima.wear-check.v1' || report.layout !== layout || !Array.isArray(report.devices)
        || !Number.isFinite(stamp) || !Number.isFinite(now) || stamp > now || now-stamp > 1500) {
      clearDevice('设备检查来源、配置或时间无效，请重新检查'); return {ok:false};
    }
    const roles=wearRoles(layout);
    const rows=roles.map(role => report.devices.filter(row => row?.role === role));
    if (report.devices.length !== roles.length || rows.some(row => row.length !== 1)) {
      clearDevice('设备数量或角色不符合本次配置'); return {ok:false};
    }
    const devices=rows.map(([row]) => ({role:row.role, source:row.source, port:row.port,
      ready: row.roleVerified === true && row.source === 'hardware' && row.fresh === true
        && typeof row.port === 'string' && /^(?:COM[1-9]\d{0,4}|\/dev\/[A-Za-z0-9_.-]{1,110})$/i.test(row.port)
        && typeof row.sourceTime === 'number' && Number.isFinite(row.sourceTime)
        && now-row.sourceTime*1000 >= 0 && now-row.sourceTime*1000 <= 200
        && Number.isFinite(row.frameAgeMs) && row.frameAgeMs >= 0 && row.frameAgeMs + now-stamp <= 200,
    }));
    const ports=devices.map(row => row.port?.toLowerCase());
    const conflict=roles.length === 2 && ports[0] && ports[0] === ports[1];
    const valid=!conflict && devices.every(row => row.ready);
    if (valid && device && stamp <= device.stamp) return {ok:false, repeated:true};
    const nextBinding=valid ? devices.map(row => `${row.role}:${row.port}`).join('|') : null;
    const changed=Boolean(nextBinding && binding && nextBinding !== binding);
    if (changed) { checked.clear(); invalidate('设备来源改变，请重新进行穿戴自查'); }
    if (nextBinding) binding=nextBinding;
    if (!valid) invalidate(conflict ? '两套设备不能使用同一实体端口' : '尚未确认所需的真实设备连接');
    device={stamp, valid, devices, conflict};
    return {ok:true, changed};
  }
  function snapshot(now) {
    const live=Boolean(device?.valid && Number.isFinite(now) && now >= device.stamp && now-device.stamp <= 1500);
    if (device?.valid && !live && approved) invalidate('连接检查已过期，请重新检查并确认');
    const required=wearItems(layout), done=required.filter(id => checked.has(id));
    return {layout, required, checked:done, manualComplete:done.length === required.length,
      approved, deviceReady:live, devices:device?.devices.map(row => ({...row})) || [],
      checkedAt:device?.stamp ?? null, reason, wearVerified:false, hardwareOutput:false};
  }
  function confirm(now, requireDevice=false) {
    const state=snapshot(now);
    if (!state.manualComplete || (requireDevice && !state.deviceReady)) return false;
    approved=true; reason=''; return true;
  }
  function canContinue(now, requireDevice=false) {
    const state=snapshot(now);
    return state.approved && state.manualComplete && (!requireDevice || state.deviceReady);
  }
  return {reset,confirmItem,ingest,snapshot,confirm,canContinue,invalidate,clearDevice};
}
