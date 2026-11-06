import { useEffect, useState } from 'react'

/** Secciones del panel que se pueden habilitar por rol. */
export const ADMIN_SECTIONS = [
  { id: 'destacados', label: 'Destacados', path: '/admin/ajustes' },
  { id: 'informacion', label: 'Información', path: '/admin/datos' },
  { id: 'contenido', label: 'Contenido', path: '/admin/contenido' },
  { id: 'instagram', label: 'Instagram', path: '/admin/redes' },
] as const

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]['id']

export type SectionPermission = {
  /** Puede abrir / ver la sección */
  view: boolean
  /** Puede editar / guardar / publicar */
  manage: boolean
}

export type AdminRole = {
  id: string
  name: string
  /** Correo del usuario al que se asigna este rol */
  email: string
  permissions: Record<AdminSectionId, SectionPermission>
}

export type AdminRolesConfig = {
  /** Correo del rol Admin: acceso total y único que asigna roles */
  adminEmail: string
  roles: AdminRole[]
}

const STORAGE_KEY = 'ifts2-admin-roles'
const SESSION_EMAIL_KEY = 'ifts2-admin-session-email'
export const ADMIN_ROLES_EVENT = 'ifts2-admin-roles-changed'

export function emptyPermissions(
  on = false,
): Record<AdminSectionId, SectionPermission> {
  return {
    destacados: { view: on, manage: on },
    informacion: { view: on, manage: on },
    contenido: { view: on, manage: on },
    instagram: { view: on, manage: on },
  }
}

export function createRole(partial?: Partial<AdminRole>): AdminRole {
  return {
    id:
      partial?.id ??
      `role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: partial?.name ?? 'Nuevo rol',
    email: partial?.email ?? '',
    permissions: partial?.permissions ?? emptyPermissions(false),
  }
}

function normalizePermission(raw: unknown): SectionPermission {
  if (!raw || typeof raw !== 'object') return { view: false, manage: false }
  const o = raw as Record<string, unknown>
  const manage = Boolean(o.manage)
  const view = manage || Boolean(o.view)
  return { view, manage }
}

const DEFAULT_ADMIN_EMAIL = 'admin@ifts2.edu.ar'

function normalizeConfig(raw: unknown): AdminRolesConfig {
  if (!raw || typeof raw !== 'object') {
    return { adminEmail: DEFAULT_ADMIN_EMAIL, roles: [] }
  }
  const o = raw as Record<string, unknown>
  const rolesIn = Array.isArray(o.roles) ? o.roles : []
  const roles: AdminRole[] = rolesIn.map((r) => {
    const row = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const permsRaw =
      row.permissions && typeof row.permissions === 'object'
        ? (row.permissions as Record<string, unknown>)
        : {}
    const permissions = emptyPermissions(false)
    for (const s of ADMIN_SECTIONS) {
      permissions[s.id] = normalizePermission(permsRaw[s.id])
    }
    return {
      id: String(row.id || createRole().id),
      name: String(row.name || 'Rol'),
      email: String(row.email || '').trim().toLowerCase(),
      permissions,
    }
  })
  return {
    adminEmail: String(o.adminEmail || DEFAULT_ADMIN_EMAIL).trim().toLowerCase(),
    roles,
  }
}

export function loadAdminRolesConfig(): AdminRolesConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { adminEmail: DEFAULT_ADMIN_EMAIL, roles: [] }
    return normalizeConfig(JSON.parse(raw) as unknown)
  } catch {
    return { adminEmail: DEFAULT_ADMIN_EMAIL, roles: [] }
  }
}

export function saveAdminRolesConfig(next: AdminRolesConfig): AdminRolesConfig {
  const normalized = normalizeConfig(next)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new Event(ADMIN_ROLES_EVENT))
  return normalized
}

export function setSessionAdminEmail(email: string | null) {
  try {
    if (!email) sessionStorage.removeItem(SESSION_EMAIL_KEY)
    else sessionStorage.setItem(SESSION_EMAIL_KEY, email.trim().toLowerCase())
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(ADMIN_ROLES_EVENT))
}

export function getSessionAdminEmail(): string {
  try {
    return (sessionStorage.getItem(SESSION_EMAIL_KEY) || '').trim().toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Admin del panel = correo marcado en config local, o rol ADMIN de la API.
 * Pasá `apiRol` cuando ya lo tengas de /api/auth/me (fuente de verdad del backend).
 */
export function isSuperAdmin(
  email = getSessionAdminEmail(),
  config = loadAdminRolesConfig(),
  apiRol?: string | null,
): boolean {
  if (apiRol && String(apiRol).toUpperCase() === 'ADMIN') return true
  if (!email) return !config.adminEmail
  if (!config.adminEmail) return true
  return email === config.adminEmail
}

/** Si el usuario API es ADMIN, alinea el adminEmail del panel a su correo. */
export function syncPanelAdminFromApi(email: string, apiRol: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized || String(apiRol).toUpperCase() !== 'ADMIN') return
  const cfg = loadAdminRolesConfig()
  if (cfg.adminEmail === normalized) return
  saveAdminRolesConfig({ ...cfg, adminEmail: normalized })
}

export function roleForEmail(
  email = getSessionAdminEmail(),
  config = loadAdminRolesConfig(),
): AdminRole | null {
  if (!email) return null
  return (
    config.roles.find((r) => r.email && r.email === email.toLowerCase()) ?? null
  )
}

export function canViewSection(
  section: AdminSectionId,
  email = getSessionAdminEmail(),
  config = loadAdminRolesConfig(),
): boolean {
  if (isSuperAdmin(email, config)) return true
  const role = roleForEmail(email, config)
  if (!role) {
    // Sin rol asignado y hay admin definido → sin acceso a secciones
    return !config.adminEmail
  }
  return role.permissions[section]?.view === true
}

export function canManageSection(
  section: AdminSectionId,
  email = getSessionAdminEmail(),
  config = loadAdminRolesConfig(),
): boolean {
  if (isSuperAdmin(email, config)) return true
  const role = roleForEmail(email, config)
  if (!role) return !config.adminEmail
  return role.permissions[section]?.manage === true
}

/** Primera ruta del panel: siempre Mi cuenta si está autenticado. */
export function firstAllowedAdminPath(
  email = getSessionAdminEmail(),
  config = loadAdminRolesConfig(),
): string | null {
  if (!email && config.adminEmail) return null
  return '/admin/mi-cuenta'
}

export function hasAnyAdminAccess(
  email = getSessionAdminEmail(),
  _config = loadAdminRolesConfig(),
): boolean {
  // Cualquier sesión autenticada puede abrir Mi cuenta.
  return Boolean(email) || !_config.adminEmail
}

export function pathToSection(pathname: string): AdminSectionId | 'configuracion' | null {
  if (pathname.includes('/admin/configuracion')) return 'configuracion'
  if (pathname.includes('/admin/ajustes')) return 'destacados'
  if (pathname.includes('/admin/datos')) return 'informacion'
  if (
    pathname.includes('/admin/contenido') ||
    pathname.includes('/admin/eventos') ||
    pathname.includes('/admin/noticias') ||
    pathname.includes('/admin/galeria')
  ) {
    return 'contenido'
  }
  if (
    pathname.includes('/admin/redes') ||
    pathname.includes('/admin/instagram')
  ) {
    return 'instagram'
  }
  return null
}

export function useAdminRolesConfig() {
  const [config, setConfig] = useState(loadAdminRolesConfig)

  useEffect(() => {
    function sync() {
      setConfig(loadAdminRolesConfig())
    }
    window.addEventListener(ADMIN_ROLES_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADMIN_ROLES_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return {
    config,
    save(next: AdminRolesConfig) {
      const saved = saveAdminRolesConfig(next)
      setConfig(saved)
      return saved
    },
  }
}

export function useSessionAdminEmail() {
  const [email, setEmail] = useState(getSessionAdminEmail)

  useEffect(() => {
    function sync() {
      setEmail(getSessionAdminEmail())
    }
    sync()
    window.addEventListener(ADMIN_ROLES_EVENT, sync)
    return () => window.removeEventListener(ADMIN_ROLES_EVENT, sync)
  }, [])

  // Valor fresco: el state puede ir un tick atrás justo tras el login.
  return getSessionAdminEmail() || email
}
