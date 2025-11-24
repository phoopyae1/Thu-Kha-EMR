import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AvatarIcon,
  CalendarIcon,
  CloseIcon,
  DashboardIcon,
  MenuIcon,
  PatientsIcon,
  PharmacyIcon,
  ReportsIcon,
  SearchIcon,
  SettingsIcon,
} from './icons';
import LogoutButton from './LogoutButton';
import { useAuth } from '../context/AuthProvider';
import { useSettings } from '../context/SettingsProvider';
import { useTranslation } from '../hooks/useTranslation';

type NavigationKey =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'billing'
  | 'pharmacy'
  | 'lab'
  | 'reports'
  | 'settings';

type NavigationItem = {
  key: NavigationKey;
  name: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  to?: string;
};

// Navigation will be created dynamically based on adminId

interface DashboardLayoutProps {
  title: string;
  subtitle?: string;
  activeItem?: NavigationKey;
  headerChildren?: ReactNode;
  children: ReactNode;
}

function DefaultHeaderSearch() {
  const { t } = useTranslation();
  return (
    <div className="relative w-full md:w-72">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        placeholder={t('Search patients...')}
        className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      />
    </div>
  );
}

export default function DashboardLayout({
  title,
  subtitle,
  activeItem = 'dashboard',
  headerChildren,
  children,
}: DashboardLayoutProps) {
  const { accessToken, user } = useAuth();
  const { appName, logo } = useSettings();
  const { t } = useTranslation();
  const { adminId: adminIdParam } = useParams<{ adminId?: string }>();
  // Use adminId from params if available, otherwise use doctorId for doctors or userId for other roles
  const adminId = adminIdParam || (user?.role === 'Doctor' && user?.doctorId ? user.doctorId : user?.userId) || '';
  const roleLabel = user ? t(ROLE_LABELS[user.role] ?? 'Team Member') : t('Team Member');
  
  // Create navigation dynamically based on adminId
  const navigation: NavigationItem[] = [
    { key: 'dashboard', name: 'Dashboard', icon: DashboardIcon, to: `/admin/${adminId}` },
    { key: 'patients', name: 'Patients', icon: PatientsIcon, to: `/admin/${adminId}/patients` },
    { key: 'appointments', name: 'Appointments', icon: CalendarIcon, to: `/admin/${adminId}/appointments` },
    { key: 'billing', name: 'Billing', icon: ReportsIcon, to: `/admin/${adminId}/billing/workspace` },
    { key: 'pharmacy', name: 'Pharmacy', icon: PharmacyIcon, to: `/admin/${adminId}/pharmacy/queue` },
    { key: 'lab', name: 'Lab Orders', icon: ReportsIcon, to: `/admin/${adminId}/lab-orders` },
    { key: 'reports', name: 'Reports', icon: ReportsIcon, to: `/admin/${adminId}/reports` },
    { key: 'settings', name: 'Settings', icon: SettingsIcon, to: `/admin/${adminId}/settings` },
  ];
  
  const navItems = navigation.filter((item) => {
    if (item.key === 'settings') {
      return user?.role === 'ITAdmin';
    }
    if (item.key === 'billing') {
      return user && ['Cashier', 'ITAdmin', 'Doctor', 'Pharmacist'].includes(user.role);
    }
    if (item.key === 'pharmacy') {
      return (
        user && ['Pharmacist', 'PharmacyTech', 'InventoryManager', 'ITAdmin'].includes(user.role)
      );
    }
    if (item.key === 'lab') {
      return user && ['Doctor', 'LabTech', 'ITAdmin'].includes(user.role);
    }
    return true;
  });
  const displayName = appName || '';
  const showSettings = user?.role === 'ITAdmin';
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const userEmail = user?.email ?? t('Signed-in user');

  function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === activeItem;
          const content = (
            <div
              className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${
                isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{t(item.name)}</span>
            </div>
          );

          if (item.to) {
            return (
              <Link
                key={item.key}
                to={item.to}
                className="block"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onNavigate?.()}
              >
                {content}
              </Link>
            );
          }

          return (
            <button
              key={item.key}
              type="button"
              className="w-full text-left"
              onClick={() => onNavigate?.()}
            >
              {content}
            </button>
          );
        })}
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="hidden w-72 flex-col border-r border-gray-200 bg-white px-6 py-8 shadow-sm md:flex lg:w-80">
        <div className="text-lg font-semibold text-blue-600">{displayName}</div>
        <nav className="mt-8 space-y-1">
          <NavigationLinks />
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <AvatarIcon className="h-6 w-6" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900">{userEmail}</div>
            <div className="text-xs text-gray-500">{roleLabel}</div>
          </div>
        </div>
      </aside>

      {isMobileNavOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-gray-900/40"
            aria-label={t('Close navigation')}
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className="relative ml-auto flex h-full w-full max-w-xs flex-col bg-white px-6 py-6 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-semibold text-blue-600">{displayName}</span>
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100"
                aria-label={t('Close navigation')}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <nav className="mt-6 space-y-1">
              <NavigationLinks onNavigate={() => setIsMobileNavOpen(false)} />
            </nav>
            <div className="mt-auto space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <AvatarIcon className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{userEmail}</div>
                  <div className="text-xs text-gray-500">{roleLabel}</div>
                </div>
              </div>
              {accessToken && (
                <div onClick={() => setIsMobileNavOpen(false)}>
                  <LogoutButton className="w-full rounded-full bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center justify-between gap-3 md:justify-start">
                <Link to="/" className="flex items-center gap-3 text-gray-900">
                  {logo ? (
                    <img src={logo} alt={`${displayName} logo`} className="h-10 w-auto rounded" />
                  ) : (
                    <span className="text-xl font-semibold">{displayName}</span>
                  )}
                  {logo && <span className="text-xl font-semibold">{displayName}</span>}
                </Link>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 md:hidden"
                  onClick={() => setIsMobileNavOpen(true)}
                  aria-label={t('Open navigation')}
                  aria-expanded={isMobileNavOpen}
                >
                  <MenuIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end md:gap-4">
                {headerChildren ?? <DefaultHeaderSearch />}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="hidden flex-col text-right text-xs text-gray-500 sm:flex">
                    <span className="font-medium text-gray-700">{userEmail}</span>
                    <span>{roleLabel}</span>
                  </div>
                  {showSettings && (
                    <Link to="/settings" className="text-sm font-medium text-blue-600 hover:underline">
                      {t('Settings')}
                    </Link>
                  )}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                    <AvatarIcon className="h-6 w-6" />
                  </div>
                  {accessToken && (
                    <LogoutButton className="text-sm font-medium text-red-600 hover:underline" />
                  )}
                </div>
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export type { NavigationKey };

const ROLE_LABELS: Record<string, string> = {
  Doctor: 'Doctor',
  AdminAssistant: 'Administrative Assistant',
  Cashier: 'Cashier',
  ITAdmin: 'IT Administrator',
  Pharmacist: 'Pharmacist',
  PharmacyTech: 'Pharmacy Technician',
  InventoryManager: 'Inventory Manager',
  Nurse: 'Nurse',
  LabTech: 'Laboratory Technician',
};
