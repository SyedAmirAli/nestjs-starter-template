export { auth, type Session, type AuthSession, type AuthUser } from '@/auth/auth';
export { DEFAULT_USER_ROLE, ADMIN_ROLES, USER_ROLES, normalizeUserRole, type UserRole } from '@/auth/user-role';
export { AuthApiModule } from '@/auth/auth-api.module';
export { isProtectedEmail, PROTECTED_USER_EMAILS } from '@/auth/protected-users';
