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
.pp-wrap{display:flex;flex-direction:column;gap:16px;font-size:13px;line-height:1.6;}
.pp-h{margin:0;font-size:15px;font-weight:600;}
.pp-note{margin:0;opacity:.7;line-height:1.7;}
.pp-card{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;}
.pp-group-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.pp-group-t{font-weight:600;font-size:13.5px;}
.pp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px 16px;}
.pp-field{display:flex;flex-direction:column;gap:4px;min-width:0;}
.pp-field-full{grid-column:1/-1;}
.pp-label{opacity:.85;}
.pp-hint{margin:0;font-size:11.5px;opacity:.55;line-height:1.5;}
.pp-in,.pp-ta{width:100%;box-sizing:border-box;padding:6px 9px;border-radius:8px;color:inherit;
  border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);
  font:inherit;font-size:13px;outline:none;}
.pp-ta{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.7;resize:vertical;}
.pp-in:focus,.pp-ta:focus{border-color:color-mix(in srgb,currentColor 42%,transparent);}
.pp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.pp-btn{font:inherit;padding:5px 12px;border-radius:8px;cursor:pointer;color:inherit;
  border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 6%,transparent);}
.pp-btn:hover:not(:disabled){background:color-mix(in srgb,currentColor 12%,transparent);}
.pp-btn:disabled{opacity:.45;cursor:default;}
.pp-btn-primary{border-color:color-mix(in srgb,currentColor 40%,transparent);}
.pp-err{color:#e5484d;}
.pp-warn{border:1px solid color-mix(in srgb,#e5a400 45%,transparent);background:color-mix(in srgb,#e5a400 10%,transparent);
  border-radius:8px;padding:8px 11px;font-size:12.5px;line-height:1.6;}
.pp-ok{opacity:.78;}
.pp-tag{font-size:11px;padding:1px 7px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);}
.pp-pre{margin:0;max-height:300px;overflow:auto;padding:10px 12px;border-radius:8px;white-space:pre-wrap;word-break:break-word;
  border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:color-mix(in srgb,currentColor 3%,transparent);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.7;}
.pp-log{max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:3px;}
.pp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;opacity:.8;word-break:break-all;}
`

    function PersonaSection() {
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

        ...GROUPS.map((group) =>
          h(
            'div',
            { className: 'pp-card', key: group.title },
            h(
              'div',
              { className: 'pp-group-h' },
              h('span', { className: 'pp-group-t' }, group.title),
              h('span', { className: 'pp-note' }, group.note),
            ),
            h('div', { className: 'pp-grid' }, ...group.fields.map(fieldNode)),
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
                      { className: 'pp-mono', key: `${row.at || index}-${index}` },
                      `${row.at ?? '?'}  ${row.kind ?? '?'}  ${row.chars ?? '?'}字`,
                    ),
                  ),
          ),
        ),
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
      },
      PersonaSection,
    }
  },
})
