import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import {
  ApiError,
  changeOwnEmail,
  changeOwnPassword,
  fetchMe,
  verifyCurrentPassword,
} from '../api'
import { AdminSaveStatus } from '../components/AdminSaveStatus'
import { ConfirmPasswordDialog } from '../components/ConfirmPasswordDialog'
import { pushAdminToast } from '../data/adminToast'
import {
  ADMIN_SECTIONS,
  createRole,
  emptyPermissions,
  getSessionAdminEmail,
  isSuperAdmin,
  loadAdminRolesConfig,
  roleForEmail,
  saveAdminRolesConfig,
  setSessionAdminEmail,
  syncPanelAdminFromApi,
  useAdminRolesConfig,
  useSessionAdminEmail,
  type AdminRole,
  type AdminSectionId,
  type SectionPermission,
} from '../data/adminRolesStore'
import { isAuthed } from './admin/adminAuth'

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label
      className={`admin-switch${disabled ? ' is-disabled' : ''}`}
      title={label}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="admin-switch__track" aria-hidden />
      <span className="admin-switch__label">{label}</span>
    </label>
  )
}

function setPerm(
  role: AdminRole,
  section: AdminSectionId,
  patch: Partial<SectionPermission>,
): AdminRole {
  const prev = role.permissions[section]
  let next: SectionPermission = { ...prev, ...patch }
  if (next.manage) next = { ...next, view: true }
  if (!next.view) next = { ...next, manage: false }
  return {
    ...role,
    permissions: { ...role.permissions, [section]: next },
  }
}

type PendingAction =
  | { kind: 'delete-role'; role: AdminRole }
  | { kind: 'save-role'; role: AdminRole; mode: 'create' | 'edit' }

export function AdminMiCuentaPage() {
  const { config, save } = useAdminRolesConfig()
  const sessionEmail = useSessionAdminEmail()

  const [loadedEmail, setLoadedEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [rolApi, setRolApi] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [banner, setBanner] = useState('')

  const superAdmin = isSuperAdmin(sessionEmail || loadedEmail, config, rolApi)
  const myRole = roleForEmail(loadedEmail || sessionEmail, config)

  const [editingAccount, setEditingAccount] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPass, setEmailPass] = useState('')
  const [emailStatus, setEmailStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [emailMsg, setEmailMsg] = useState('')

  const [currentPass, setCurrentPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [passStatus, setPassStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [passMsg, setPassMsg] = useState('')

  /** Roles persistidos (solo se mutan al confirmar con contraseña). */
  const [roles, setRoles] = useState(config.roles)
  /** Borrador de rol nuevo (cancelable sin guardar). */
  const [creating, setCreating] = useState<AdminRole | null>(null)
  /** Edición de un rol existente (cancelable). */
  const [editingRole, setEditingRole] = useState<AdminRole | null>(null)

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  useEffect(() => {
    setRoles(config.roles)
  }, [config.roles])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMe()
      .then((me) => {
        if (cancelled) return
        setLoadedEmail(me.email)
        setNombre(`${me.nombre} ${me.apellido}`.trim())
        setRolApi(me.rol)
        setSessionAdminEmail(me.email)
        syncPanelAdminFromApi(me.email, me.rol)
        setLoadError('')
        setBanner('')
      })
      .catch((err) => {
        if (cancelled) return
        const status = err instanceof ApiError ? err.status : undefined
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'No se pudo cargar el perfil'
        if (status === 403 || /permisos para acceder/i.test(msg)) {
          const fallback = (sessionEmail || getSessionAdminEmail()).trim()
          if (fallback) {
            setLoadedEmail(fallback)
            setNombre(fallback)
            if (fallback === 'admin@ifts2.edu.ar') {
              setRolApi('ADMIN')
              syncPanelAdminFromApi(fallback, 'ADMIN')
            }
            setBanner(
              'Aviso: falta desplegar /api/auth/me en Render. El panel funciona; cambiar email/contraseña requiere esa API.',
            )
          } else {
            setLoadError(
              'El backend aún no tiene /api/auth/me. Publicá la API y volvé a entrar.',
            )
          }
        } else {
          setLoadError(msg)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (emailStatus !== 'saved' && emailStatus !== 'error') return
    const t = window.setTimeout(() => setEmailStatus('idle'), 1800)
    return () => window.clearTimeout(t)
  }, [emailStatus])

  useEffect(() => {
    if (passStatus !== 'saved' && passStatus !== 'error') return
    const t = window.setTimeout(() => setPassStatus('idle'), 1800)
    return () => window.clearTimeout(t)
  }, [passStatus])

  if (!isAuthed()) return <Navigate to="/admin/login" replace />

  function persistRoles(next: AdminRole[]) {
    const saved = save({
      ...loadAdminRolesConfig(),
      adminEmail: config.adminEmail || loadedEmail || 'admin@ifts2.edu.ar',
      roles: next.map((r) => ({
        ...r,
        name: r.name.trim() || 'Rol',
        email: r.email.trim().toLowerCase(),
      })),
    })
    setRoles(saved.roles)
  }

  async function onSaveEmail(e: FormEvent) {
    e.preventDefault()
    const next = newEmail.trim().toLowerCase()
    if (!next.includes('@') || !emailPass) {
      setEmailStatus('error')
      setEmailMsg('Completá el nuevo email y tu contraseña actual.')
      return
    }
    setEmailStatus('saving')
    try {
      const me = await changeOwnEmail({
        email: next,
        currentPassword: emailPass,
      })
      const prev = loadedEmail
      setLoadedEmail(me.email)
      setNewEmail('')
      setEmailPass('')
      setSessionAdminEmail(me.email)
      const cfg = loadAdminRolesConfig()
      if (cfg.adminEmail === prev) {
        saveAdminRolesConfig({ ...cfg, adminEmail: me.email })
      } else {
        saveAdminRolesConfig({
          ...cfg,
          roles: cfg.roles.map((r) =>
            r.email === prev ? { ...r, email: me.email } : r,
          ),
        })
      }
      setEmailStatus('saved')
      setEmailMsg('Email actualizado.')
      pushAdminToast({ kind: 'success', title: 'Email actualizado' })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error'
      setEmailStatus('error')
      setEmailMsg(msg)
    }
  }

  async function onSavePassword(e: FormEvent) {
    e.preventDefault()
    if (!currentPass || newPass.length < 12 || newPass !== confirmPass) {
      setPassStatus('error')
      setPassMsg(
        !currentPass
          ? 'Ingresá tu contraseña actual.'
          : newPass !== confirmPass
            ? 'La confirmación no coincide.'
            : 'Mínimo 12 caracteres.',
      )
      return
    }
    setPassStatus('saving')
    try {
      await changeOwnPassword({
        currentPassword: currentPass,
        newPassword: newPass,
      })
      setCurrentPass('')
      setNewPass('')
      setConfirmPass('')
      setPassStatus('saved')
      setPassMsg('Contraseña actualizada.')
      pushAdminToast({ kind: 'success', title: 'Contraseña actualizada' })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error'
      setPassStatus('error')
      setPassMsg(msg)
    }
  }

  function startCreate() {
    setEditingRole(null)
    setCreating(
      createRole({
        name: '',
        email: '',
        permissions: emptyPermissions(false),
      }),
    )
  }

  function cancelCreate() {
    setCreating(null)
  }

  function startEdit(role: AdminRole) {
    setCreating(null)
    setEditingRole({ ...role, permissions: { ...role.permissions } })
  }

  function cancelEdit() {
    setEditingRole(null)
  }

  async function confirmPending(password: string) {
    if (!pending) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      await verifyCurrentPassword(loadedEmail || sessionEmail, password)
      if (pending.kind === 'delete-role') {
        persistRoles(roles.filter((r) => r.id !== pending.role.id))
        if (editingRole?.id === pending.role.id) setEditingRole(null)
        pushAdminToast({ kind: 'success', title: 'Rol eliminado' })
      } else if (pending.mode === 'create') {
        persistRoles([...roles, pending.role])
        setCreating(null)
        pushAdminToast({ kind: 'success', title: 'Rol creado' })
      } else {
        persistRoles(
          roles.map((r) => (r.id === pending.role.id ? pending.role : r)),
        )
        setEditingRole(null)
        pushAdminToast({ kind: 'success', title: 'Rol actualizado' })
      }
      setPending(null)
    } catch (err) {
      setConfirmError(
        err instanceof ApiError
          ? err.message
          : 'Contraseña incorrecta o no se pudo confirmar.',
      )
    } finally {
      setConfirmBusy(false)
    }
  }

  function requestSaveRole(role: AdminRole, mode: 'create' | 'edit') {
    if (!role.name.trim()) {
      pushAdminToast({ kind: 'error', title: 'Falta el nombre del rol' })
      return
    }
    if (!role.email.trim().includes('@')) {
      pushAdminToast({ kind: 'error', title: 'Indicá un email válido' })
      return
    }
    setPending({ kind: 'save-role', role, mode })
  }

  function renderRoleForm(
    role: AdminRole,
    mode: 'create' | 'edit',
    onChange: (next: AdminRole) => void,
  ) {
    return (
      <div className="panel stack admin-mi-cuenta__role admin-mi-cuenta__role-form">
        <h3 className="admin-docs__editor-title">
          {mode === 'create' ? 'Nuevo rol' : 'Editar rol'}
        </h3>
        <div className="admin-mi-cuenta__role-fields">
          <div className="bedelia__field">
            <label htmlFor={`rn-${role.id}`}>Nombre</label>
            <input
              id={`rn-${role.id}`}
              value={role.name}
              onChange={(e) => onChange({ ...role, name: e.target.value })}
              placeholder="Ej. Bedelía"
            />
          </div>
          <div className="bedelia__field">
            <label htmlFor={`re-${role.id}`}>Email asignado</label>
            <input
              id={`re-${role.id}`}
              type="email"
              value={role.email}
              onChange={(e) => onChange({ ...role, email: e.target.value })}
              placeholder="usuario@ejemplo.com"
            />
          </div>
        </div>
        <div className="admin-config__perms" role="group" aria-label="Permisos">
          <div className="admin-config__perms-head">
            <span>Sección</span>
            <span>Ver</span>
            <span>Gestionar</span>
          </div>
          {ADMIN_SECTIONS.map((s) => {
            const p = role.permissions[s.id]
            return (
              <div key={s.id} className="admin-config__perm-row">
                <span className="admin-config__perm-label">{s.label}</span>
                <Switch
                  label="Ver"
                  checked={p.view}
                  onChange={(v) => onChange(setPerm(role, s.id, { view: v }))}
                />
                <Switch
                  label="Gestionar"
                  checked={p.manage}
                  onChange={(v) => onChange(setPerm(role, s.id, { manage: v }))}
                />
              </div>
            )
          })}
        </div>
        <div className="admin-docs__actions">
          <button
            type="button"
            className="btn btn--primary btn--inline"
            onClick={() => requestSaveRole(role, mode)}
          >
            Guardar
          </button>
          <button
            type="button"
            className="btn btn--inline"
            onClick={mode === 'create' ? cancelCreate : cancelEdit}
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack admin-mi-cuenta">
      <div className="admin-page-head" style={{ flexDirection: 'column' }}>
        <p className="page-kicker">Admin</p>
        <h1 className="page-title">Mi cuenta</h1>
      </div>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : !loadedEmail && loadError ? (
        <div className="notice" role="alert">
          {loadError}
        </div>
      ) : (
        <>
          {banner ? (
            <div className="notice" role="status">
              {banner}
            </div>
          ) : null}

          <div className="panel stack admin-mi-cuenta__account">
            <div className="admin-mi-cuenta__account-head">
              <p className="admin-mi-cuenta__meta" style={{ margin: 0 }}>
                {nombre || loadedEmail}
                {superAdmin || rolApi === 'ADMIN' ? (
                  <span className="admin-role-badge"> · Admin</span>
                ) : myRole ? (
                  ` · ${myRole.name}`
                ) : rolApi ? (
                  ` · ${rolApi}`
                ) : null}
              </p>
              {!editingAccount ? (
                <button
                  type="button"
                  className="btn btn--primary btn--inline"
                  onClick={() => {
                    setEditingAccount(true)
                    setNewEmail('')
                    setEmailPass('')
                    setCurrentPass('')
                    setNewPass('')
                    setConfirmPass('')
                  }}
                >
                  Editar
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--inline"
                  onClick={() => setEditingAccount(false)}
                >
                  Cancelar
                </button>
              )}
            </div>

            {editingAccount ? (
              <div className="admin-mi-cuenta__edit-grid">
                <form
                  className="stack admin-mi-cuenta__edit-card"
                  onSubmit={onSaveEmail}
                >
                  <h2 className="admin-config__h2">Cambiar email</h2>
                  <div className="bedelia__field">
                    <label htmlFor="me-new-email">Nuevo email</label>
                    <input
                      id="me-new-email"
                      type="email"
                      autoComplete="off"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="nuevo@correo.com"
                      required
                    />
                  </div>
                  <div className="bedelia__field">
                    <label htmlFor="me-email-pass">Contraseña actual</label>
                    <input
                      id="me-email-pass"
                      type="password"
                      value={emailPass}
                      onChange={(e) => setEmailPass(e.target.value)}
                      required
                    />
                  </div>
                  <div className="admin-docs__actions">
                    <button
                      type="submit"
                      className="btn btn--primary btn--inline"
                      disabled={emailStatus === 'saving'}
                    >
                      Guardar email
                    </button>
                    <AdminSaveStatus status={emailStatus} message={emailMsg} />
                  </div>
                </form>

                <form
                  className="stack admin-mi-cuenta__edit-card"
                  onSubmit={onSavePassword}
                >
                  <h2 className="admin-config__h2">Cambiar contraseña</h2>
                  <div className="bedelia__field">
                    <label htmlFor="me-pass-current">Contraseña actual</label>
                    <input
                      id="me-pass-current"
                      type="password"
                      value={currentPass}
                      onChange={(e) => setCurrentPass(e.target.value)}
                      required
                    />
                  </div>
                  <div className="bedelia__field">
                    <label htmlFor="me-pass-new">Nueva</label>
                    <input
                      id="me-pass-new"
                      type="password"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      minLength={12}
                      required
                    />
                  </div>
                  <div className="bedelia__field">
                    <label htmlFor="me-pass-confirm">Confirmar</label>
                    <input
                      id="me-pass-confirm"
                      type="password"
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      minLength={12}
                      required
                    />
                  </div>
                  <div className="admin-docs__actions">
                    <button
                      type="submit"
                      className="btn btn--primary btn--inline"
                      disabled={passStatus === 'saving'}
                    >
                      Guardar contraseña
                    </button>
                    <AdminSaveStatus status={passStatus} message={passMsg} />
                  </div>
                </form>
              </div>
            ) : null}
          </div>

          <section className="stack">
            <h2 className="admin-config__h2">Mi rol</h2>
            {superAdmin ? (
              <p className="muted" style={{ margin: 0 }}>
                Admin: acceso total. Solo vos podés crear, editar o borrar roles
                de otros (con tu contraseña).
              </p>
            ) : myRole ? (
              <ul className="admin-perms-readonly">
                {ADMIN_SECTIONS.map((s) => {
                  const p = myRole.permissions[s.id]
                  const label = !p.view
                    ? 'Sin acceso'
                    : p.manage
                      ? 'Ver y gestionar'
                      : 'Solo ver'
                  return (
                    <li key={s.id}>
                      <span>{s.label}</span>
                      <span className="muted">{label}</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted">
                Todavía no tenés un rol asignado. Pedile al Admin.
              </p>
            )}
          </section>

          {superAdmin ? (
            <section className="stack">
              <div className="admin-config__roles-head">
                <h2 className="admin-config__h2">Roles del panel</h2>
                {!creating && !editingRole ? (
                  <button
                    type="button"
                    className="btn btn--inline"
                    onClick={startCreate}
                  >
                    + Agregar rol
                  </button>
                ) : null}
              </div>

              <div
                className={`admin-mi-cuenta__roles-layout${
                  creating || editingRole ? ' is-editing' : ''
                }`}
              >
                <div className="admin-mi-cuenta__roles-list">
                  {roles.length === 0 ? (
                    <p className="muted">No hay roles todavía.</p>
                  ) : (
                    <ul className="admin-docs__list">
                      {roles.map((r) => (
                        <li key={r.id} className="admin-docs__card">
                          <div className="admin-docs__card-main">
                            <p className="admin-docs__card-title">
                              {r.name || 'Sin nombre'}
                            </p>
                            <p className="admin-docs__card-meta">
                              {r.email || 'Sin email'}
                            </p>
                          </div>
                          <div className="admin-docs__card-actions">
                            <button
                              type="button"
                              className="btn btn--small btn--inline"
                              disabled={Boolean(creating || editingRole)}
                              onClick={() => startEdit(r)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger btn--small btn--inline"
                              disabled={Boolean(creating || editingRole)}
                              onClick={() =>
                                setPending({ kind: 'delete-role', role: r })
                              }
                            >
                              Eliminar
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {creating
                  ? renderRoleForm(creating, 'create', setCreating)
                  : null}
                {editingRole
                  ? renderRoleForm(editingRole, 'edit', setEditingRole)
                  : null}
              </div>
            </section>
          ) : null}
        </>
      )}

      <ConfirmPasswordDialog
        open={Boolean(pending)}
        title="¿Estás seguro?"
        message={
          pending?.kind === 'delete-role'
            ? `Vas a eliminar el rol «${pending.role.name || pending.role.email}». Ingresá tu contraseña de ingreso.`
            : pending?.kind === 'save-role'
              ? pending.mode === 'create'
                ? 'Vas a crear este rol. Ingresá tu contraseña de ingreso para confirmar.'
                : 'Vas a guardar cambios en este rol. Ingresá tu contraseña de ingreso.'
              : ''
        }
        confirmLabel={
          pending?.kind === 'delete-role' ? 'Sí, eliminar' : 'Sí, guardar'
        }
        busy={confirmBusy}
        error={confirmError}
        onCancel={() => {
          setPending(null)
          setConfirmError('')
        }}
        onConfirm={(pwd) => void confirmPending(pwd)}
      />
    </div>
  )
}
