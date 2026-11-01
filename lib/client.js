window.__ModuleLoader__.load({
  id: 'dsh-peach-persona',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState, useCallback, useMemo } = React

    const NS = 'peach-persona'
    const NAV = '人设'
    const API = '/api/peach-persona'

    const short = (error) => String((error && error.message) || error || '未知错误')

    // 字段族参考：Character Card V2（name / description / personality /
    // system_prompt / post_history_instructions）与 ChatGPT custom instructions
    // 的「关于你 + 怎么回答」两分法。落成我们能实际用上的 11 项。
    const GROUPS = [
      {
        title: '身份',
        note: '它管自己叫什么、怎么叫你、跟你是什么关系。',
        fields: [
          { key: 'agentName', label: '名字', hint: '它会把自己叫这个名字。', placeholder: '例如：小助手' },
          { key: 'nickname', label: '简称', hint: '留空就不再提简称。', placeholder: '例如：小助' },
          { key: 'userTitle', label: '对你的称呼', hint: '它怎么称呼你。', placeholder: '例如：老板' },
          { key: 'selfRef', label: '自称', hint: '跟你说话时它用哪个词指代自己（我 / 本人 / 俺）。留空就不提。', placeholder: '例如：我' },
          { key: 'relationship', label: '关系定位', hint: '接在「是」后面，例如：你的工作搭子。', placeholder: '例如：你的工作搭子' },
          { key: 'language', label: '语言', hint: '留空则整行省略。例如：中文', placeholder: '中文' },
        ],
      },
      {
        title: '说话方式',
        note: '决定它回话的调子和密度。',
        fields: [
          { key: 'tone', label: '说话基调', rows: 5, hint: '不奉承 / 不热演 / 语气词这些都可以写在这里。' },
          { key: 'verbosity', label: '篇幅', rows: 3, hint: '例如：适中，先给结论。' },
          { key: 'disagreement', label: '分歧时怎么办', rows: 3, hint: '它不同意你时该怎么做。' },
        ],
      },
      {
        title: '行为准则',
        note: '这些会排在系统提示词靠后的位置，是「最后说的话」。',
        fields: [
          { key: 'rulesHeading', label: '这个小块的标题', hint: '留空则没有标题行。', placeholder: '例如：与我共事的约定：' },
          { key: 'rules', label: '共事约定', rows: 8, hint: '一条一行，建议自己编号。' },
          { key: 'avoid', label: '禁忌 / 不做什么', rows: 3, hint: '留空则整段省略。' },
        ],
      },
    ]

    const FIELD_LIST = GROUPS.flatMap((group) => group.fields)
    const EMPTY = Object.fromEntries(FIELD_LIST.map((f) => [f.key, '']))

    const CSS = `
.pp-wrap{display:flex;flex-direction:column;gap:18px;max-width:780px;font-size:13px;line-height:1.7;-webkit-font-smoothing:antialiased;}
.pp-h{margin:0;font-size:16px;font-weight:650;letter-spacing:.01em;}
.pp-note{margin:0;font-size:12px;opacity:.62;line-height:1.75;}
.pp-card{border:1px solid color-mix(in srgb,currentColor 11%,transparent);border-radius:14px;
  background:color-mix(in srgb,currentColor 2.5%,transparent);padding:16px 18px;display:flex;flex-direction:column;gap:14px;}
.pp-sec{display:flex;flex-direction:column;gap:12px;padding-top:14px;
  border-top:1px solid color-mix(in srgb,currentColor 9%,transparent);}
.pp-sec:first-child{padding-top:0;border-top:0;}
.pp-sec-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.pp-sec-t{font-size:13.5px;font-weight:650;letter-spacing:.01em;}
.pp-sec-n{font-size:12px;opacity:.55;}
.pp-group-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.pp-group-t{font-weight:600;font-size:13.5px;}
.pp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px 18px;}
.pp-field{display:flex;flex-direction:column;gap:6px;min-width:0;}
.pp-field-full{grid-column:1/-1;}
.pp-label{font-size:12.5px;font-weight:550;opacity:.9;letter-spacing:.01em;}
.pp-hint{margin:0;font-size:11.5px;opacity:.5;line-height:1.6;}
.pp-in,.pp-ta{width:100%;box-sizing:border-box;padding:8px 11px;border-radius:9px;color:inherit;
  border:1px solid color-mix(in srgb,currentColor 16%,transparent);
  background:color-mix(in srgb,currentColor 3.5%,transparent);
  font:inherit;font-size:13px;line-height:1.65;outline:none;
  transition:border-color .12s ease,box-shadow .12s ease,background-color .12s ease;}
.pp-in:hover,.pp-ta:hover{border-color:color-mix(in srgb,currentColor 26%,transparent);}
.pp-in:focus,.pp-ta:focus{background:color-mix(in srgb,currentColor 6%,transparent);
  border-color:color-mix(in srgb,currentColor 44%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,currentColor 10%,transparent);}
.pp-ta{resize:vertical;min-height:72px;}
.pp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.pp-stats{display:flex;gap:8px;flex-wrap:wrap;margin:0;}
.pp-stat{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border-radius:999px;
  border:1px solid color-mix(in srgb,currentColor 12%,transparent);
  background:color-mix(in srgb,currentColor 3%,transparent);font-size:11.5px;}
.pp-stat-k{opacity:.55;}
.pp-stat-v{font-weight:600;}
.pp-btn{font:inherit;font-size:12.5px;line-height:1;padding:8px 14px;border-radius:9px;cursor:pointer;color:inherit;
  border:1px solid color-mix(in srgb,currentColor 16%,transparent);
  background:color-mix(in srgb,currentColor 5%,transparent);white-space:nowrap;
  transition:background-color .12s ease,border-color .12s ease,opacity .12s ease;}
.pp-btn:hover:not(:disabled){background:color-mix(in srgb,currentColor 11%,transparent);
  border-color:color-mix(in srgb,currentColor 26%,transparent);}
.pp-btn:active:not(:disabled){background:color-mix(in srgb,currentColor 16%,transparent);}
.pp-btn:disabled{opacity:.4;cursor:default;}
.pp-btn-primary{font-weight:600;border-color:color-mix(in srgb,currentColor 42%,transparent);
  background:color-mix(in srgb,currentColor 13%,transparent);}
.pp-btn-primary:hover:not(:disabled){background:color-mix(in srgb,currentColor 19%,transparent);}
.pp-btn-ghost{padding:5px 9px;border-color:transparent;background:transparent;opacity:.55;font-size:12px;}
.pp-btn-ghost:hover:not(:disabled){opacity:1;background:color-mix(in srgb,currentColor 8%,transparent);}
.pp-err{color:#e5484d;font-size:12.5px;}
.pp-warn{border:1px solid color-mix(in srgb,#e5a400 40%,transparent);
  background:color-mix(in srgb,#e5a400 9%,transparent);border-radius:10px;
  padding:10px 13px;font-size:12.5px;line-height:1.7;display:flex;flex-direction:column;gap:6px;}
.pp-ok{font-size:12px;opacity:.72;}
.pp-tag{display:inline-flex;align-items:center;font-size:11px;line-height:1;padding:3px 8px;border-radius:999px;
  border:1px solid color-mix(in srgb,currentColor 14%,transparent);opacity:.85;}
.pp-pre{margin:0;max-height:300px;overflow:auto;padding:12px 14px;border-radius:10px;white-space:pre-wrap;word-break:break-word;
  border:1px solid color-mix(in srgb,currentColor 10%,transparent);
  background:color-mix(in srgb,currentColor 3%,transparent);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.75;}
.pp-log{max-height:200px;overflow:auto;display:flex;flex-direction:column;}
.pp-logrow{display:flex;gap:10px;padding:5px 0;font-size:11.5px;
  border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent);}
.pp-logrow:last-child{border-bottom:0;}
.pp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;opacity:.8;word-break:break-all;}
/* 行：卡片里的一切都走这条流水线——左对齐一致、右边缘一致、不套框 */
.pp-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.pp-card > .pp-btn{align-self:flex-start;}      /* 按钮绝不拉满宽 */
.pp-actions > .pp-btn{align-self:auto;}
.pp-entry{display:flex;align-items:flex-start;gap:10px;
  padding:9px 0 9px 11px;
  border-left:2px solid color-mix(in srgb,currentColor 24%,transparent);
  border-bottom:1px solid color-mix(in srgb,currentColor 7%,transparent);}
.pp-entry:last-child{border-bottom:0;}
.pp-entry-pending{border-left-color:color-mix(in srgb,#e5a400 62%,transparent);}
.pp-entry-t{flex:1 1 auto;min-width:0;word-break:break-word;line-height:1.7;font-size:12.5px;}
.pp-entry > .pp-btn{flex:0 0 auto;align-self:flex-start;}
.pp-spacer{flex:1 1 auto;}
.pp-empty{padding:14px;text-align:center;border-radius:10px;font-size:12px;opacity:.55;
  border:1px dashed color-mix(in srgb,currentColor 12%,transparent);}
.pp-banner{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
  margin:0 0 6px;padding:7px 12px;border-radius:9px;font-size:12px;line-height:1.5;
  border:1px solid color-mix(in srgb,#e5a400 34%,transparent);
  background:color-mix(in srgb,#e5a400 8%,transparent);}
.pp-banner-t{font-weight:600;}
.pp-banner-s{opacity:.6;font-size:11.5px;}
`

    // 成长记录面板：可增可删（B）+ 提议待确认（C）。
    // 提议由 agent 写进 growth-pending.jsonl（一行一个 JSON），这里只负责让人采纳或丢弃；
    // 采纳之前那条**不注入**，所以我不可能自己给自己加规矩。
    function GrowthPanel({ state, reload }) {
      const g = (state && state.growth) || {}
      const entries = Array.isArray(g.entries) ? g.entries : []
      const pending = Array.isArray(g.pending) ? g.pending : []
      const max = Number(g.max ?? 4000)
      const chars = Number(g.chars ?? 0)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const [note, setNote] = useState('')
      const [probe, setProbe] = useState(null) // null=还没探测过
      const [similar, setSimilar] = useState([]) // 查重命中
      const sources = Array.isArray(state?.memory?.sources) ? state.memory.sources : []

      /** 统一 POST：任何路径都走这里，失败抛错。 */
      const send2 = async (path, body) => {
        const res = await fetch(`${API}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        const json = await res.json()
        if (!json || json.ok !== true) throw new Error((json && json.error) || '操作失败')
        return json
      }

      const post = async (path, body) => {
        setBusy(path)
        setErr('')
        setNote('')
        try {
          await send2(`/growth/${path}`, body)
          if (path === 'add') setDraft('')
          setNote(
            path === 'add'
              ? '已加入 · 下一回合生效'
              : path === 'delete'
                ? '已删除'
                : path === 'approve'
                  ? '已采纳 · 下一回合生效'
                  : '已丢弃',
          )
          await reload()
        } catch (error) {
          setErr(short(error))
        } finally {
          setBusy('')
        }
      }

      /** 新增前先查重：命中了就停下来问一句，不替使用者决定。 */
      const tryAdd = async () => {
        const text = draft.trim()
        if (text === '') return
        setBusy('add')
        setErr('')
        setNote('')
        setSimilar([])
        try {
          const checked = await send2('/growth/check', { text })
          const hits = Array.isArray(checked.similar) ? checked.similar : []
          if (hits.length > 0) {
            setSimilar(hits)
            return
          }
          await send2('/growth/add', { text })
          setDraft('')
          setNote('已加入 · 下一回合生效')
          await reload()
        } catch (error) {
          setErr(short(error))
        } finally {
          setBusy('')
        }
      }

      const forceAdd = async () => {
        setBusy('add')
        setErr('')
        try {
          await send2('/growth/add', { text: draft })
          setDraft('')
          setSimilar([])
          setNote('已加入 · 下一回合生效')
          await reload()
        } catch (error) {
          setErr(short(error))
        } finally {
          setBusy('')
        }
      }

      const probeNow = async () => {
        setBusy('probe')
        setErr('')
        setNote('')
        try {
          const json = await send2('/memory/probe', {})
          setProbe(Array.isArray(json.candidates) ? json.candidates : [])
        } catch (error) {
          setErr(short(error))
        } finally {
          setBusy('')
        }
      }

      const connectSource = async (p, label) => {
        setBusy('connect')
        setErr('')
        setNote('')
        try {
          await send2('/memory/connect', { path: p, label })
          setNote('已连接 · 之后新增成长会先查重')
          await reload()
        } catch (error) {
          setErr(short(error))
        } finally {
          setBusy('')
        }
      }

      const disconnectSource = async (p) => {
        setBusy('disconnect')
        setErr('')
        setNote('')
        try {
          await send2('/memory/disconnect', { path: p })
          setNote('已断开')
          await reload()
        } catch (error) {
          setErr(short(error))
        } finally {
          setBusy('')
        }
      }

      const near = chars / max > 0.85

      return h(
        'div',
        { className: 'pp-card' },
        h(
          'div',
          { className: 'pp-row' },
          h('b', null, '成长记录'),
          h('span', { className: 'pp-tag' }, `${chars} / ${max} 字`),
          pending.length > 0 ? h('span', { className: 'pp-tag' }, `${pending.length} 条待确认`) : null,
        ),
        h(
          'p',
          { className: 'pp-note' },
          '人格定型之后学到的，跟着人设一起注入。一条一行——写「以后遇到类似情况该怎么做」，别写「这次发生了什么」。',
        ),
        near
          ? h(
              'div',
              { className: 'pp-warn' },
              `已用 ${chars} / ${max} 字。超上限的部分会被「静默截断」：不注入、也不报错。`,
            )
          : null,

        entries.length === 0
          ? h('p', { className: 'pp-empty' }, '还没学到什么。')
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              ...entries.map((text, i) =>
                h(
                  'div',
                  { className: 'pp-entry', key: `e${i}` },
                  h('span', { className: 'pp-entry-t' }, text),
                  h(
                    'button',
                    { className: 'pp-btn pp-btn-ghost', disabled: busy !== '', onClick: () => post('delete', { text }) },
                    '删除',
                  ),
                ),
              ),
            ),

        h(
          'div',
          { className: 'pp-row' },
          h('input', {
            className: 'pp-in',
            style: { flex: '1 1 auto', minWidth: 0 },
            value: draft,
            placeholder: '例如：他问「有意义吗」时，是在问值不值得做，不是能不能做',
            onChange: (event) => {
              setDraft(event.target.value)
              setNote('')
            },
          }),
          h(
            'button',
            {
              className: 'pp-btn pp-btn-primary',
              disabled: busy !== '' || draft.trim() === '',
              onClick: tryAdd,
            },
            busy === 'add' ? '添加中…' : '添加',
          ),
        ),

        // 查重命中：停下来问一句，不替使用者决定
        similar.length > 0
          ? h(
              'div',
              { className: 'pp-warn' },
              h('div', null, '这条可能已经记在外部记忆里了：'),
              ...similar
                .slice(0, 3)
                .map((m, i) => h('div', { className: 'pp-mono', key: `s${i}` }, `${m.file}:${m.line}　${m.text}`)),
              h(
                'div',
                { className: 'pp-row', style: { marginTop: '6px' } },
                h(
                  'button',
                  { className: 'pp-btn pp-btn-primary', disabled: busy !== '', onClick: forceAdd },
                  '仍然添加',
                ),
                h('button', { className: 'pp-btn', disabled: busy !== '', onClick: () => setSimilar([]) }, '算了'),
              ),
            )
          : null,

        // 外部记忆：可选适配。默认不读任何人的记忆，探测只是找候选。
        h(
          'div',
          { className: 'pp-row' },
          h(
            'span',
            { className: 'pp-note' },
            sources.length > 0
              ? `外部记忆：已连接 ${sources.length} 个 · 只用来查重，不注入`
              : '外部记忆：未连接（本插件不依赖任何记忆系统）',
          ),
          h('span', { className: 'pp-spacer' }),
          h(
            'button',
            { className: 'pp-btn', disabled: busy !== '', onClick: probeNow },
            busy === 'probe' ? '探测中…' : '探测本机记忆',
          ),
        ),

        sources.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              ...sources.map((s) =>
                h(
                  'div',
                  { className: 'pp-entry', key: s.path },
                  h('span', { className: 'pp-entry-t' }, s.label ? `${s.label}　${s.path}` : s.path),
                  h(
                    'button',
                    { className: 'pp-btn', disabled: busy !== '', onClick: () => disconnectSource(s.path) },
                    '断开',
                  ),
                ),
              ),
            )
          : null,

        probe !== null
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h(
                'p',
                { className: 'pp-note' },
                probe.length === 0
                  ? '没找到可连接的记忆目录。没有也没关系——本插件不需要它。'
                  : '探测到的候选（你点了才连，不点我不会去读）：',
              ),
              ...probe.map((c) =>
                h(
                  'div',
                  { className: 'pp-entry', key: c.path },
                  h('span', { className: 'pp-entry-t' }, `${c.label}　${c.path}（${c.files} 个 md）`),
                  h(
                    'button',
                    {
                      className: 'pp-btn pp-btn-primary',
                      disabled: busy !== '' || c.connected,
                      onClick: () => connectSource(c.path, c.label),
                    },
                    c.connected ? '已连接' : '连接',
                  ),
                ),
              ),
            )
          : null,

        pending.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('p', { className: 'pp-note' }, '待确认（提议，采纳前不注入）：'),
              ...pending.map((item) =>
                h(
                  'div',
                  { className: 'pp-entry pp-entry-pending', key: item.id },
                  h(
                    'span',
                    { className: 'pp-entry-t' },
                    item.at
                      ? h(
                          'span',
                          { className: 'pp-mono', style: { marginRight: '8px', opacity: 0.55 } },
                          String(item.at).slice(0, 10),
                        )
                      : null,
                    item.text,
                    item.reason ? h('span', { className: 'pp-note' }, `　— ${item.reason}`) : null,
                  ),
                  h(
                    'button',
                    {
                      className: 'pp-btn pp-btn-primary',
                      disabled: busy !== '',
                      onClick: () => post('approve', { id: item.id }),
                    },
                    '采纳',
                  ),
                  h(
                    'button',
                    { className: 'pp-btn', disabled: busy !== '', onClick: () => post('reject', { id: item.id }) },
                    '丢弃',
                  ),
                ),
              ),
            )
          : null,

        note ? h('p', { className: 'pp-ok' }, note) : null,
        err ? h('div', { className: 'pp-err' }, err) : null,
        h('p', { className: 'pp-note' }, `文件：${g.file ?? ''}　提议：${g.pendingFile ?? ''}`),
      )
    }

    // 横幅自己带样式：它渲染在对话区，设置页那份 <style> 在这个 slot 里根本不存在。
    const BANNER_CSS = `
.pp-banner{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
  margin:0 0 6px;padding:7px 12px;border-radius:9px;font-size:12px;line-height:1.5;
  border:1px solid color-mix(in srgb,#e5a400 34%,transparent);
  background:color-mix(in srgb,#e5a400 8%,transparent);}
.pp-banner-t{font-weight:600;}
.pp-banner-s{opacity:.6;font-size:11.5px;}
`

    function PersonaSection() {
      // 版本探针：只在第一次渲染时打一行。用来判断浏览器加载的到底是哪一版代码——
      // 控制台里看得到这行 = 新代码在跑；看不到 = 跑的还是旧 bundle。
      if (typeof window !== 'undefined' && !window.__ppProbe) {
        window.__ppProbe = 'lock-ui-v3'
        try {
          console.warn('[peach-persona] build=lock-ui-v3 loaded')
        } catch {
          /* 控制台不可用也不能出事 */
        }
      }
      const [state, setState] = useState(null)
      const [form, setForm] = useState(EMPTY)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [preview, setPreview] = useState('')

      const load = useCallback(async () => {
        setBusy('load')
        setError('')
        try {
          const res = await fetch(`${API}/state`, { cache: 'no-store' })
          const json = await res.json()
          if (!json || json.ok !== true) throw new Error((json && json.error) || '读取失败')
          setState(json)
          // 宿主侧若是旧版本（没有 fields），不要用空表单覆盖：留空并提示。
          if (json.fields && typeof json.fields === 'object') {
            setForm({ ...EMPTY, ...json.fields })
          }
        } catch (err) {
          setError(`读不到状态：${short(err)}`)
        } finally {
          setBusy('')
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const hostReady = Boolean(state && state.fields && typeof state.fields === 'object')
      // 宿主可能是旧版本（认识字段表但还不认识后来新增的键）。这时保存会把新键
      // 静默丢掉，所以先拦住，而不是让人白丢一次配置。
      const hostKnowsAllFields = hostReady && FIELD_LIST.every((f) => f.key in state.fields)
      const missingFields = hostReady ? FIELD_LIST.filter((f) => !(f.key in state.fields)).map((f) => f.label) : []
      const dirty = useMemo(() => {
        if (!hostReady) return false
        return FIELD_LIST.some((f) => (form[f.key] ?? '') !== (state.fields[f.key] ?? ''))
      }, [hostReady, state, form])

      const setField = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }))
        setNotice('')
      }

      const save = useCallback(async () => {
        setBusy('save')
        setError('')
        setNotice('')
        try {
          const res = await fetch(`${API}/save`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: form }),
          })
          const json = await res.json()
          if (!json || json.ok !== true) throw new Error((json && json.error) || '保存失败')
          setNotice(`已保存 · ${json.chars} 字 · 下一回合生效`)
          setPreview('')
          await load()
        } catch (err) {
          setError(`保存失败：${short(err)}`)
        } finally {
          setBusy('')
        }
      }, [form, load])

      const showPreview = useCallback(async () => {
        setBusy('preview')
        setError('')
        try {
          const res = await fetch(`${API}/preview`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: form }),
          })
          const json = await res.json()
          if (!json || json.ok !== true) throw new Error((json && json.error) || '预览失败')
          setPreview(json.text ?? '')
        } catch (err) {
          setError(`预览失败：${short(err)}（宿主侧可能还是旧版本）`)
        } finally {
          setBusy('')
        }
      }, [form])

      // setLock 必须放在所有条件早退之前：hooks 数量在两次渲染之间必须一致。
      // 这里 `if (!hostReady)` 就是最早的那道门，所以它必须排在这个门前面。
      const setLock = useCallback(
        async (next) => {
          setBusy('lock')
          setError('')
          setNotice('')
          try {
            const res = await fetch(`${API}/${next ? 'lock' : 'unlock'}`, { method: 'POST' })
            const json = await res.json()
            if (!json || json.ok !== true) throw new Error((json && json.error) || '操作失败')
            await load()
          } catch (err) {
            setError(`操作失败：${short(err)}`)
          } finally {
            setBusy('')
          }
        },
        [load],
      )

      if (!hostReady) {
        return h(
          'div',
          { className: 'pp-wrap' },
          h('style', null, CSS),
          h('h2', { className: 'pp-h' }, NAV),
          h(
            'div',
            { className: 'pp-warn' },
            '宿主侧还是旧版本（接口没返回字段）。',
            h('br', null),
            '分段表单要等应用重启一次才会生效；这一页现在不会动你的任何人设。',
          ),
          error ? h('div', { className: 'pp-err' }, error) : null,
          h(
            'div',
            { className: 'pp-row' },
            h('button', { className: 'pp-btn', onClick: load, disabled: busy !== '' }, busy === 'load' ? '读取中…' : '重新读取'),
          ),
        )
      }

      const fieldNode = (f) => {
        const value = form[f.key] ?? ''
        const rows = f.rows ?? 0
        const control =
          rows > 0
            ? h('textarea', {
                className: 'pp-ta',
                rows,
                value,
                spellCheck: false,
                placeholder: f.placeholder ?? '',
                onChange: (event) => setField(f.key, event.target.value),
              })
            : h('input', {
                className: 'pp-in',
                value,
                spellCheck: false,
                placeholder: f.placeholder ?? '',
                onChange: (event) => setField(f.key, event.target.value),
              })
        return h(
          'div',
          { className: `pp-field${rows > 0 ? ' pp-field-full' : ''}`, key: f.key },
          h('label', { className: 'pp-label' }, f.label),
          control,
          f.hint ? h('p', { className: 'pp-hint' }, f.hint) : null,
        )
      }

      // state 还没回来时先给占位：下面正文里有 `state.drift` 这类直接取值，
      // 一旦在 null 上求值，整个设置页会变成空白（React 把错误吞了）。
      if (!state) {
        return h(
          'div',
          { className: 'pp-wrap' },
          h('style', null, CSS),
          h('h2', { className: 'pp-h' }, NAV),
          error
            ? h('div', { className: 'pp-err' }, error)
            : h('p', { className: 'pp-note' }, '读取中…'),
        )
      }

      // ── 锁定态 ──────────────────────────────────────────────────────────
      // 设计一旦定型，表单收起来，只留「重新编辑」和成长记录。
      // 锁定只影响这一页的形态，不动人设文件、也不影响注入。
      const locked = Boolean(state.locked === true)
      const lockedAt = String(state.lockedAt ?? '')

      if (locked) {
        return h(
          'div',
          { className: 'pp-wrap' },
          h('style', null, CSS),
          h('h2', { className: 'pp-h' }, NAV),
          h(
            'div',
            { className: 'pp-card' },
            h(
              'div',
              { className: 'pp-row' },
              h('b', null, '人设已定型'),
              h('span', { className: 'pp-tag' }, lockedAt ? `锁定于 ${lockedAt.slice(0, 16).replace('T', ' ')}` : '已锁定'),
            ),
            h('p', { className: 'pp-note' }, '设计已完成，注入保持不变。要改就点下面，改完再锁回来。'),
            h(
              'div',
              { className: 'pp-actions' },
              h(
                'button',
                {
                  className: 'pp-btn pp-btn-primary',
                  onClick: () => setLock(false),
                  disabled: busy !== '',
                },
                busy === 'lock' ? '处理中…' : '重新编辑',
              ),
            ),
          ),
          h(GrowthPanel, { state, reload: load }),
          error ? h('div', { className: 'pp-err' }, error) : null,
        )
      }

      return h(
        'div',
        { className: 'pp-wrap' },
        h('style', null, CSS),
        h('h2', { className: 'pp-h' }, NAV),
        h(
          'p',
          { className: 'pp-note' },
          '这些字段会拼成一段人设，注入到每一次请求。改完保存，',
          h('b', null, '下一回合'),
          '生效（正在跑的这一步不会变）。',
        ),

        // 顶部状态胶囊：一眼看到「现在注入多少字 / 最后一次是什么时候」。
        h(
          'div',
          { className: 'pp-stats' },
          h(
            'span',
            { className: 'pp-stat' },
            h('span', { className: 'pp-stat-k' }, '注入字数'),
            h('span', { className: 'pp-stat-v' }, String(state.chars ?? 0)),
          ),
          h(
            'span',
            { className: 'pp-stat' },
            h('span', { className: 'pp-stat-k' }, '最后注入'),
            h(
              'span',
              { className: 'pp-stat-v' },
              state.lastInjected?.at ? String(state.lastInjected.at).slice(11, 19) : '—',
            ),
          ),
          h(
            'span',
            { className: 'pp-stat' },
            h('span', { className: 'pp-stat-k' }, '字段'),
            h('span', { className: 'pp-stat-v' }, String(FIELD_LIST.length)),
          ),
        ),

        state.drift
          ? h(
              'div',
              { className: 'pp-warn' },
              '注入文件被外部改过，和下面的字段不一致。你一保存，就会按字段重新生成并覆盖文件。',
            )
          : null,

        hostReady && !hostKnowsAllFields
          ? h(
              'div',
              { className: 'pp-warn' },
              `宿主侧还不认识这些字段：${missingFields.join('、')}。`,
              h('br', null),
              '现在保存会把它们丢掉——先重启一次应用，再来改。',
            )
          : null,

        // 全新安装时表单是空的：别让人以为插件坏了。
        FIELD_LIST.every((f) => (form[f.key] ?? '') === '')
          ? h(
              'div',
              { className: 'pp-warn' },
              '还没有设置人设。空字段不会渲染，所以现在什么都不会注入——',
              h('br', null),
              '填任意几项（最省事：名字 + 对你的称呼 + 共事约定），保存后下一回合生效。',
            )
          : null,

        // 三组合并进一张卡：少三个边框，多三条分隔线，视觉噪音直接降一半。
        h(
          'div',
          { className: 'pp-card' },
          ...GROUPS.map((group) =>
            h(
              'div',
              { className: 'pp-sec', key: group.title },
              h(
                'div',
                { className: 'pp-sec-h' },
                h('span', { className: 'pp-sec-t' }, group.title),
                h('span', { className: 'pp-sec-n' }, group.note),
              ),
              h('div', { className: 'pp-grid' }, ...group.fields.map(fieldNode)),
            ),
          ),
        ),

        h(
          'div',
          { className: 'pp-row' },
          h(
            'button',
            {
              className: 'pp-btn pp-btn-primary',
              onClick: save,
              disabled: busy !== '' || !dirty || !hostKnowsAllFields,
            },
            !hostKnowsAllFields ? '需重启后才能保存' : busy === 'save' ? '保存中…' : dirty ? '保存' : '没有改动',
          ),
          h('button', { className: 'pp-btn', onClick: showPreview, disabled: busy !== '' }, busy === 'preview' ? '生成中…' : '看最终长什么样'),
          h('button', { className: 'pp-btn', onClick: load, disabled: busy !== '' }, busy === 'load' ? '读取中…' : '撤销改动'),
          h(
            'button',
            { className: 'pp-btn', onClick: () => setLock(true), disabled: busy !== '' || !hostKnowsAllFields },
            '完成设计，定型',
          ),
          notice ? h('span', { className: 'pp-ok' }, notice) : null,
        ),

        error ? h('div', { className: 'pp-err' }, error) : null,

        preview
          ? h(
              'div',
              { className: 'pp-card' },
              h('b', null, '最终注入的样子（未保存）'),
              h('pre', { className: 'pp-pre' }, preview),
            )
          : null,

        h(GrowthPanel, { state, reload: load }),

        h(
          'div',
          { className: 'pp-card' },
          h('div', { className: 'pp-row' }, h('b', null, '注入记录'), h('span', { className: 'pp-tag' }, '最近 12 条')),
          h('p', { className: 'pp-note' }, '只有渲染文本变化时才记一行。有记录 = 真的装配过。'),
          h('p', { className: 'pp-note' }, `字段文件：${state.jsonFile ?? ''}`),
          h(
            'div',
            { className: 'pp-log' },
            (state.log ?? []).length === 0
              ? h('span', { className: 'pp-note' }, '还没有记录。发出一次对话后再回来看看。')
              : (state.log ?? [])
                  .slice()
                  .reverse()
                  .map((row, index) =>
                    h(
                      'div',
                      { className: 'pp-logrow', key: `${row.at || index}-${index}` },
                      h('span', { className: 'pp-mono' }, String(row.at ?? '?').slice(11, 19)),
                      h('span', { className: 'pp-mono', style: { opacity: 0.5 } }, String(row.kind ?? '?')),
                      h('span', { style: { marginLeft: 'auto' } }, `${row.chars ?? '?'} 字`),
                    ),
                  ),
          ),
        ),
      )
    }

    // 待确认横幅：只有存在「待确认」的成长提议时才出现，挂在输入框上方。
    // 为什么要它：提议只躺在设置页里，不开设置就永远看不到 —— 等于半残。
    // 全部防御性写法：取不到状态就当没有，任何异常都不渲染。
    function PendingBanner() {
      const [pending, setPending] = useState(0)
      const [selfRef, setSelfRef] = useState('')

      useEffect(() => {
        let alive = true
        const pull = async () => {
          try {
            const res = await fetch(`${API}/state`, { cache: 'no-store' })
            const json = await res.json()
            if (!alive || !json || json.ok !== true) return
            const list = json.growth && Array.isArray(json.growth.pending) ? json.growth.pending : []
            setPending(list.length)
            // 用使用者自己填的「自称」，不是写死某个人的
            setSelfRef(String(json.fields?.selfRef ?? '').trim())
          } catch {
            // 宿主不可用 / 没装插件：静默，不打扰对话
          }
        }
        pull()
        const timer = setInterval(pull, 60000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      if (!(pending > 0)) return null
      return h(
        'div',
        { className: 'pp-banner' },
        h('style', null, BANNER_CSS),
        h(
          'span',
          { className: 'pp-banner-t' },
          selfRef ? `${selfRef}有 ${pending} 条成长记录待你确认` : `有 ${pending} 条成长记录待你确认`,
        ),
        h('span', { className: 'pp-banner-s' }, '设置 → 人设 → 成长记录'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                { name: 'settings.section', id: NS, order: 116, label: () => NAV },
                PersonaSection,
              ),
              'peach-persona: settings section',
            ),
          'peach-persona: settings section',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.input.dock', () =>
              ctx.slots.register(
                { name: 'conversation.input.dock', id: `${NS}-pending`, order: 40 },
                PendingBanner,
              ),
              'peach-persona: pending banner',
            ),
          'peach-persona: pending banner',
        )
      },
      PersonaSection,
      PendingBanner,
    }
  },
})
