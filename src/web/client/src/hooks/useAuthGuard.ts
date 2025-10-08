import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PermissionLevel } from '../types/permission';

interface UserInfo {
  userId: string;
  username: string;
  avatar?: string | null;
  permission: PermissionLevel;
}

interface AuthGuardOptions {
  requireStaff?: boolean;
  requireAdmin?: boolean;
  requireOwner?: boolean;
}

export const useAuthGuard = (options: AuthGuardOptions = {}) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirect, setRedirect] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;

    const checkAuth = async () => {
      try {
        console.log('[AuthGuard] Starting auth check for path:', location.pathname);
        const response = await fetch('/api/auth/session', {
          credentials: 'include'
        });

        if (!mounted) {
          console.log('[AuthGuard] Component unmounted, aborting');
          return;
        }

        if (response.ok) {
          const data = await response.json();
          const userData = data.user;

          if (userData) {
            setUser(userData);

            // Check permissions for staff-required routes
            const guildPermissions = userData.permissions || [];
            const hasRequiredPermission =
              !options.requireStaff ||
              guildPermissions.some((p: any) =>
                p.level >= PermissionLevel.STAFF
              ) &&
              (!options.requireAdmin ||
                guildPermissions.some((p: any) =>
                  p.level >= PermissionLevel.ADMIN
                )
              ) &&
              (!options.requireOwner ||
                guildPermissions.some((p: any) =>
                  p.level >= PermissionLevel.OWNER
                )
              );

            console.log('[AuthGuard] Has permission:', hasRequiredPermission, 'Options:', options);

            if (!hasRequiredPermission) {
              // Store current path for redirect after login
              const returnPath = location.pathname + location.search;
              console.log('[AuthGuard] No permission, redirecting to home, storing return path:', returnPath);
              localStorage.setItem('returnPath', returnPath);
              setRedirect('/');
            } else {
              console.log('[AuthGuard] Access granted');
              setRedirect(null);
            }
          } else {
            // Not authenticated
            console.log('[AuthGuard] Not authenticated, redirecting to home');
            const returnPath = location.pathname + location.search;
            localStorage.setItem('returnPath', returnPath);
            setRedirect('/');
          }
        } else {
          // No valid session
          console.log('[AuthGuard] Invalid session response:', response.status);
          const returnPath = location.pathname + location.search;
          localStorage.setItem('returnPath', returnPath);
          setRedirect('/');
        }
      } catch (error) {
        console.error('[AuthGuard] Auth check failed:', error);
        const returnPath = location.pathname + location.search;
        localStorage.setItem('returnPath', returnPath);
        setRedirect('/');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Prevent multiple simultaneous checks
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(checkAuth, 10);

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [options.requireStaff, options.requireAdmin, options.requireOwner]); // Remove location dependencies

  return { user, loading, redirect };
};