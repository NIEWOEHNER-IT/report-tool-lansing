/** Einstieg Admin-Bereich (dist/frontend/admin/admin.js). */
import { mountApp } from '../common/Shell';
import { AdminApp } from './AdminApp';

mountApp({
    title: 'Bautagesberichte – Administration',
    requiredRole: 'admin',
    children: (context) => <AdminApp context={context} />,
});
