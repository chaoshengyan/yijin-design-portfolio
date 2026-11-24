/* jOURnal only: confirmed content, local media, stable identity. No other case data. */
window.PORTFOLIO_PROJECTS = Object.freeze({
  journal: {
    projectId: 'journal',
    title: 'jOURnal',
    category: 'XR',
    summary: '以空间界面组织照片、视频与日常灵感，探索不同于二维笔记的记忆表达方式。',
    metadata: [
      { label: '类型', value: '团队项目' },
      { label: '职责', value: '团队组长；UI 图标设计、原型演示与最终展示视频，结合 AI 及剪辑工具完成内容交付。' }
    ],
    hero: {
      kind: 'original',
      images: [{ src: 'assets/previews/journal.webp', alt: 'jOURnal 项目主视觉', width: 1000, height: 1000 }]
    },
    moduleOrder: ['background', 'designs', 'outcome'],
    background: {
      title: '背景与目标',
      text: '常见笔记工具以列表和页面组织内容。jOURnal尝试将照片、视频与灵感放入空间界面，探索记忆内容的组织与浏览方式。',
      media: {
        kind: 'split',
        images: [{ src: 'assets/projects/journal/01_p2.webp', alt: 'jOURnal 团队材料中的笔记工具背景与项目目标', width: 1600, height: 900 }]
      }
    },
    designs: [
      {
        title: '空间内容组织',
        text: '方案以媒体库与空间界面连接不同类型的记忆素材，并以全景照片、视频呈现场景内容。'
      },
      {
        title: '图标与界面语言',
        text: '以拼图与云形构成视觉语言，结合黄黑配色、功能图标与界面组件，统一界面表达。',
        media: {
          kind: 'full',
          images: [{ src: 'assets/projects/journal/08_p9.webp', alt: 'jOURnal 的拼图与云形视觉语言、黄黑配色、功能图标和界面组件', width: 1600, height: 900 }]
        }
      }
    ],
    outcome: {
      title: '成果展示',
      text: '团队材料通过 Unity 原型截图呈现空间界面与媒体内容组织方案，并展示图标及界面设计。',
      media: {
        kind: 'full',
        images: [{ src: 'assets/projects/journal/12_p13.webp', alt: 'jOURnal 团队材料中的 Unity 空间界面与媒体内容原型截图', width: 2000, height: 1125 }]
      }
    }
  }
});
