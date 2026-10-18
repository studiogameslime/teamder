// Separate entry point for the future, explicitly authorised Pulse rollout.
// Not exported from the Teamder deployment entry point.
import * as admin from 'firebase-admin';
if (!admin.apps.length) admin.initializeApp();
export { pulseAdminProxy } from './pulseAdminProxy';
