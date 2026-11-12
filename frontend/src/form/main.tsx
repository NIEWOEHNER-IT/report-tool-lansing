/** Einstieg Formular (dist/frontend/index.js). */
import { mountApp } from '../common/Shell';
import { FormApp } from './FormApp';

mountApp({
    title: 'Bautagesbericht',
    requiredRole: 'employee',
    children: (context) => <FormApp context={context} />,
});
