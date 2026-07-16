export type SfxEntry = {
  id: string;
  name: string;
  icon: string;
  url: string;
  /** When to use this sound in interactive courseware. */
  scenes: string[];
};

/** Teaching SFX hosted on CDN (mirrored from demo/ss.html). */
export const SFX_CATALOG: SfxEntry[] = [
  { id: "correct", name: "正确", icon: "✅", url: "https://cdn.qxai666.com/sfx/teaching/correct.mp3", scenes: ["答对", "选对", "判题正确", "闯关成功反馈"] },
  { id: "wrong", name: "错误", icon: "❌", url: "https://cdn.qxai666.com/sfx/teaching/wrong.mp3", scenes: ["答错", "选错", "轻量错误提示"] },
  { id: "fail", name: "失败", icon: "💔", url: "https://cdn.qxai666.com/sfx/teaching/fail.mp3", scenes: ["闯关失败", "游戏结束", "任务未完成"] },
  { id: "success", name: "成功", icon: "🏆", url: "https://cdn.qxai666.com/sfx/teaching/success.mp3", scenes: ["通关", "任务完成", "大成就达成"] },
  { id: "cheer", name: "欢呼", icon: "🎉", url: "https://cdn.qxai666.com/sfx/teaching/cheer.mp3", scenes: ["庆祝", "全班答对", "高潮时刻"] },
  { id: "oops", name: "啊欧", icon: "😳", url: "https://cdn.qxai666.com/sfx/teaching/oops.mp3", scenes: ["闹乌龙", "意外状况", "可爱失误"] },
  { id: "ding", name: "叮叮", icon: "🔔", url: "https://cdn.qxai666.com/sfx/teaching/ding.mp3", scenes: ["提示音", "消息到达", "轻提醒"] },
  { id: "knock", name: "咚咚", icon: "🚪", url: "https://cdn.qxai666.com/sfx/teaching/knock.mp3", scenes: ["敲门", "进入场景", "悬念铺垫"] },
  { id: "click", name: "点击", icon: "👆", url: "https://cdn.qxai666.com/sfx/teaching/click.mp3", scenes: ["按钮点击", "选项切换", "菜单操作"] },
  { id: "got-it", name: "收到", icon: "👌", url: "https://cdn.qxai666.com/sfx/teaching/got-it.mp3", scenes: ["确认收到", "提交成功", "操作已记录"] },
  { id: "warning", name: "警告", icon: "⚠️", url: "https://cdn.qxai666.com/sfx/teaching/warning.mp3", scenes: ["危险操作", "倒计时预警", "规则提醒"] },
  { id: "time-up", name: "时间到", icon: "⏰", url: "https://cdn.qxai666.com/sfx/teaching/time-up.mp3", scenes: ["倒计时结束", "答题超时", "限时挑战截止"] },
  { id: "start", name: "开始", icon: "▶️", url: "https://cdn.qxai666.com/sfx/teaching/start.mp3", scenes: ["开始游戏", "进入关卡", "开场"] },
  { id: "pause", name: "暂停", icon: "⏸️", url: "https://cdn.qxai666.com/sfx/teaching/pause.mp3", scenes: ["暂停", "中断", "等待继续"] },
  { id: "level-up", name: "升级", icon: "🆙", url: "https://cdn.qxai666.com/sfx/teaching/level-up.mp3", scenes: ["升级", "进阶", "解锁新关卡"] },
  { id: "coin", name: "金币", icon: "💰", url: "https://cdn.qxai666.com/sfx/teaching/coin.mp3", scenes: ["得分", "收集奖励", "积分增加"] },
  { id: "applause", name: "掌声", icon: "👏", url: "https://cdn.qxai666.com/sfx/teaching/applause.mp3", scenes: ["谢幕", "表扬", "结局鼓掌"] },
  { id: "thinking", name: "思考", icon: "🤔", url: "https://cdn.qxai666.com/sfx/teaching/thinking.mp3", scenes: ["等待作答", "NPC 思考", "悬念停顿"] },
  { id: "question", name: "疑问", icon: "❓", url: "https://cdn.qxai666.com/sfx/teaching/question.mp3", scenes: ["提问", "疑惑", "引导思考"] },
  { id: "goodbye", name: "再见", icon: "👋", url: "https://cdn.qxai666.com/sfx/teaching/goodbye.mp3", scenes: ["结束页", "退出", "告别"] },
];

const BY_ID = new Map(SFX_CATALOG.map((entry) => [entry.id, entry]));

export function getSfxById(id: string): SfxEntry | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

export function listSfxIds(): string[] {
  return SFX_CATALOG.map((entry) => entry.id);
}
