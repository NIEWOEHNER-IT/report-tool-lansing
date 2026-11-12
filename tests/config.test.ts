import assert from 'node:assert/strict';
import { it } from 'node:test';
import { loadConfig } from '../server/src/config';

it('leere MAIL_FROM/MAIL_FROM_NAME aus dem Stack fallen auf Standardwerte zurück', () => {
    const config = loadConfig({ SMTP_HOST: 'mail.example.invalid', SMTP_USER: 'noreply@example.invalid', MAIL_FROM: '', MAIL_FROM_NAME: '' } as NodeJS.ProcessEnv);
    assert.equal(config.smtp?.from, 'noreply@example.invalid');
    assert.equal(config.smtp?.fromName, 'LANSING Metallbau – Bautagesbericht');
    assert.equal(config.smtp?.port, 587);
    assert.equal(config.smtp?.secure, false);
});

it('Admin: Bautagebuch Admin und immer chayns-Manager', () => {
    assert.deepEqual(loadConfig({} as NodeJS.ProcessEnv).adminGroupIds, [223675, 1]);
    assert.deepEqual(loadConfig({ UAC_GROUP_ADMIN: '223675' } as NodeJS.ProcessEnv).adminGroupIds, [223675, 1]);
});

it('ohne SMTP_HOST kein Versand', () => {
    assert.equal(loadConfig({ SMTP_HOST: '', SMTP_USER: 'x@example.invalid' } as NodeJS.ProcessEnv).smtp, null);
});
