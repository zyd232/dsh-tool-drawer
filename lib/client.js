/**
 * dsh-tool-drawer — browser half.
 *
 * Hand-written client bundle in the loader's lazy-CJS factory format
 * (`window.__ModuleLoader__.load({ id: <package name>, factory })`), which is
 * what the client module system serves for a package declaring `dsh.client` and
 * exporting `./client`. No build step: the artifact IS this file.
 *
 * It contributes one Settings left-sidebar section (`settings.section`) so the
 * two modes are explained in plain language instead of as a raw config value.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tool-drawer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')

    /** Must equal the bundle row id and the host settings namespace. */
    var NS = 'tool-drawer'
    var inject = ['slots', 'configForms', 'locale']

    var MESSAGES = {
      en: {
        sectionLabel: 'Tool drawer',
        intro:
          'Keeps the tool list small: only the tools on your desk stay in front of the model, the rest sit in a drawer and are fetched when needed. Turn it off to get the stock list back.',
        enableLabel: 'Enable',
        enableDesc: 'Off = every tool is listed directly, exactly like DSH does without this plugin.',
        enableOn: 'On',
        enableOff: 'Off',
        modeLabel: 'Mode',
        modeProxyTitle: 'Drawer (recommended)',
        modeProxyDesc: 'Tools stay in the drawer until they are needed. Smallest context; changing tools never stalls the model.',
        modeExpandTitle: 'Desk',
        modeExpandDesc: 'Tools you touch stay on the desk. More accurate calls, but takes more room and can stall when the list changes.',
        coreLabel: 'Always on the desk',
        coreDesc: 'Comma separated. These tools are always directly callable, with no search step.',
        maxActiveLabel: 'Desk size',
        maxActiveDesc: 'Desk mode only: how many fetched tools may stay on the desk before the oldest is put back.',
        searchLimitLabel: 'Search results',
        searchLimitDesc: 'How many tools one search returns.',
        reset: 'Default',
        resetTitle: 'Clear your override and fall back to the shipped default',
        loading: 'Reading settings…',
        noService: 'The settings service is unavailable (the tool-drawer namespace is not mounted).',
        unavailable: 'The host does not expose the tool-drawer namespace, so there is nothing to edit.',
        readOnly: 'This connection is read-only; changes are not written to the host.',
      },
      zh: {
        sectionLabel: '工具抽屉',
        intro:
          '把工具表换小：常用的留在桌面上，其余收进抽屉，需要时再取。关掉就恢复 DSH 原样。',
        enableLabel: '启用',
        enableDesc: '关闭 = 所有工具直接列出来，和没装插件时一样。',
        enableOn: '已启用',
        enableOff: '已关闭',
        modeLabel: '模式',
        modeProxyTitle: '抽屉模式（推荐）',
        modeProxyDesc: '工具放在抽屉里，用到才取。上下文最省，换工具不会卡。',
        modeExpandTitle: '桌面模式',
        modeExpandDesc: '摸过的工具就留在桌面上。调用更准，但占地方，切换时可能卡一下。',
        coreLabel: '常驻工具',
        coreDesc: '逗号分隔。这些工具一直直接可用，不用搜索。',
        maxActiveLabel: '桌面容量',
        maxActiveDesc: '仅桌面模式：最多留几个工具在桌面上，超出就把最旧的收回抽屉。',
        searchLimitLabel: '搜索结果数',
        searchLimitDesc: '每次搜索返回几个工具。',
        reset: '默认',
        resetTitle: '清除你的覆盖值，回到出厂默认',
        loading: '正在读取设置…',
        noService: '设置服务不可用（tool-drawer 命名空间未挂载）。',
        unavailable: '宿主没有提供 tool-drawer 命名空间，这里没有可编辑的内容。',
        readOnly: '当前连接只读，改动不会写入宿主。',
      },
    }

    var h = React.createElement
    var rowStyle = { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 0' }
    var labelStyle = { fontSize: '13px', fontWeight: 600 }
    var hintStyle = { fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }
    var inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      fontSize: '13px',
      borderRadius: '6px',
      border: '1px solid rgba(128,128,128,0.35)',
      background: 'transparent',
      color: 'inherit',
    }

    function Hint(text) {
      return h('div', { style: hintStyle }, text)
    }

    function Field(props) {
      var draft = React.useState(String(props.value ?? ''))
      var text = draft[0]
      var setText = draft[1]
      React.useEffect(
        function () {
          setText(String(props.value ?? ''))
        },
        [props.value],
      )
      var control
      if (props.type === 'switch') {
        control = h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': props.value === true,
            'aria-label': props.label,
            disabled: props.disabled === true,
            onClick: function () {
              props.onCommit(props.value !== true)
            },
            style: Object.assign({}, inputStyle, { width: 'auto', minWidth: '72px', cursor: 'pointer', fontWeight: 600 }),
          },
          props.value === true ? props.onLabel : props.offLabel,
        )
      } else if (props.type === 'textarea') {
        control = h('textarea', {
          rows: 3,
          value: text,
          disabled: props.disabled,
          'aria-label': props.label,
          style: Object.assign({}, inputStyle, { resize: 'vertical', fontFamily: 'inherit' }),
          onChange: function (event) {
            setText(event.currentTarget.value)
          },
          onBlur: function () {
            props.onCommit(text)
          },
        })
      } else {
        control = h('input', {
          type: props.type === 'number' ? 'number' : 'text',
          value: text,
          step: props.type === 'number' ? 1 : undefined,
          disabled: props.disabled,
          'aria-label': props.label,
          style: inputStyle,
          onChange: function (event) {
            setText(event.currentTarget.value)
          },
          onBlur: function () {
            if (props.type === 'number') {
              var parsed = Number(text)
              if (!Number.isFinite(parsed) || parsed < 1) {
                setText(String(props.value ?? ''))
                return
              }
              props.onCommit(parsed)
              return
            }
            props.onCommit(text)
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter') event.currentTarget.blur()
          },
        })
      }
      return h(
        'div',
        { style: rowStyle },
        h('div', { style: labelStyle }, props.label),
        props.description ? Hint(props.description) : null,
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          control,
          h(
            'button',
            {
              type: 'button',
              disabled: props.disabled || props.overridden !== true,
              title: props.resetTitle,
              onClick: function () {
                props.onReset()
              },
              style: Object.assign({}, inputStyle, {
                width: 'auto',
                cursor: props.overridden === true ? 'pointer' : 'default',
                opacity: props.overridden === true ? 1 : 0.45,
              }),
            },
            props.resetLabel,
          ),
        ),
      )
    }

    function ModeCard(props) {
      var selected = props.selected === true
      return h(
        'button',
        {
          type: 'button',
          disabled: props.disabled === true,
          'aria-pressed': selected,
          onClick: props.onSelect,
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            textAlign: 'left',
            padding: '12px 14px',
            borderRadius: '8px',
            border: selected ? '2px solid #4f8cff' : '1px solid rgba(128,128,128,0.35)',
            background: selected ? 'rgba(79,140,255,0.10)' : 'transparent',
            color: 'inherit',
            cursor: props.disabled === true ? 'default' : 'pointer',
          },
        },
        h('div', { style: { fontSize: '13px', fontWeight: 700 } }, props.title),
        h('div', { style: hintStyle }, props.description),
      )
    }

    function Section(props) {
      var form = props && props.form
      var t = props && typeof props.t === 'function' ? props.t : function (key) { return key }
      var localeFace = props && props.localeFace
      var bump = React.useState(0)
      var setBump = bump[1]
      React.useEffect(
        function () {
          if (!localeFace || typeof localeFace.subscribe !== 'function') return undefined
          return localeFace.subscribe(function () {
            setBump(function (n) { return n + 1 })
          })
        },
        [localeFace],
      )

      var state = React.useState(function () {
        return form ? form.getSnapshot() : undefined
      })
      var snapshot = state[0]
      var setSnapshot = state[1]
      React.useEffect(
        function () {
          if (!form) return undefined
          setSnapshot(form.getSnapshot())
          return form.subscribe(function () {
            setSnapshot(form.getSnapshot())
          })
        },
        [form],
      )

      if (!form || !snapshot) return Hint(t('noService'))
      if (snapshot.status === 'loading') return Hint(t('loading'))
      if (snapshot.status === 'unavailable' || snapshot.value === undefined) return Hint(t('unavailable'))

      var value = snapshot.value
      var user = snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : {}
      var writable = snapshot.writable === true
      var set = function (field, next) {
        if (!writable) return
        void form.set(field, next)
      }
      var unset = function (field) {
        if (!writable) return
        void form.unset(field)
      }
      var overridden = function (field) {
        return Object.prototype.hasOwnProperty.call(user, field)
      }
      var field = function (id, extra) {
        return Object.assign(
          {
            resetLabel: t('reset'),
            resetTitle: t('resetTitle'),
            disabled: !writable,
            overridden: overridden(id),
            onCommit: function (next) {
              set(id, next)
            },
            onReset: function () {
              unset(id)
            },
          },
          extra,
        )
      }

      var mode = value.mode === 'expand' ? 'expand' : 'proxy'

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        Hint(t('intro')),
        h(Field, field('enabled', {
          label: t('enableLabel'),
          description: t('enableDesc'),
          onLabel: t('enableOn'),
          offLabel: t('enableOff'),
          type: 'switch',
          value: value.enabled === true,
        })),
        h('div', { style: rowStyle },
          h('div', { style: labelStyle }, t('modeLabel')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h(ModeCard, {
              title: t('modeProxyTitle'),
              description: t('modeProxyDesc'),
              selected: mode === 'proxy',
              disabled: !writable,
              onSelect: function () {
                set('mode', 'proxy')
              },
            }),
            h(ModeCard, {
              title: t('modeExpandTitle'),
              description: t('modeExpandDesc'),
              selected: mode === 'expand',
              disabled: !writable,
              onSelect: function () {
                set('mode', 'expand')
              },
            }),
          ),
        ),
        h(Field, field('coreTools', {
          label: t('coreLabel'),
          description: t('coreDesc'),
          type: 'textarea',
          value: value.coreTools,
        })),
        h(Field, field('maxActive', {
          label: t('maxActiveLabel'),
          description: t('maxActiveDesc'),
          type: 'number',
          value: value.maxActive,
        })),
        h(Field, field('searchLimit', {
          label: t('searchLimitLabel'),
          description: t('searchLimitDesc'),
          type: 'number',
          value: value.searchLimit,
        })),
        writable ? null : Hint(t('readOnly')),
      )
    }

    function apply(ctx) {
      var locale = ctx.locale
      var t = locale && typeof locale.bind === 'function' ? locale.bind(NS) : function (key) { return key }

      if (locale && typeof locale.register === 'function') {
        ctx.effect(
          function () {
            var disposers = []
            for (var id of ['en', 'zh']) {
              try {
                disposers.push(locale.register(NS, id, MESSAGES[id]))
              } catch (error) {
                // keep the remaining locales; the fallback chain covers the gap
              }
            }
            return function () {
              for (var dispose of disposers) {
                try {
                  dispose()
                } catch (error) {
                  // disposers are idempotent; ignore
                }
              }
            }
          },
          'tool-drawer: dictionaries',
        )
      }

      var forms = ctx.configForms
      if (!forms || typeof forms.get !== 'function') return
      var form = forms.get(NS)
      var register = function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: NS,
              order: 56,
              label: function () {
                return t('sectionLabel')
              },
              locale: NS,
              inject: function () {
                return { form: form, t: t, localeFace: locale }
              },
            },
            Section,
          )
        })
      }
      if (typeof forms.whileServed !== 'function') {
        ctx.effect(register, 'tool-drawer: settings section')
        return
      }
      ctx.effect(
        function () {
          return forms.whileServed([NS], register)
        },
        'tool-drawer: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.MESSAGES = MESSAGES
    return module.exports
  },
})
