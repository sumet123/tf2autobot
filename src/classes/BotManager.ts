import async from 'async';
import SchemaManager from 'tf2-schema-2';
import io from 'socket.io-client';
import pm2 from 'pm2';

import Bot from './Bot';

import log from '../lib/logger';
import { waitForWriting } from '../lib/files';
import Options from './Options';
import { EPersonaState } from 'steam-user';

const REQUIRED_OPTS = ['STEAM_ACCOUNT_NAME', 'STEAM_PASSWORD', 'STEAM_SHARED_SECRET', 'STEAM_IDENTITY_SECRET'];

export default class BotManager {
    private readonly socket: SocketIOClient.Socket;

    private readonly mySocket: SocketIOClient.Socket;

    private readonly schemaManager: SchemaManager;

    private bot: Bot = null;

    private stopRequested = false;

    private stopRequestCount = 0;

    private stopping = false;

    private exiting = false;

    constructor(pricestfApiToken?: string) {
        this.schemaManager = new SchemaManager({});
        this.socket = io('https://api.prices.tf', {
            forceNew: true,
            autoConnect: false
        });

        this.socket.on('connect', () => {
            log.debug('Connected to socket server');
            this.socket.emit('authentication', pricestfApiToken);
        });

        this.socket.on('authenticated', () => {
            log.debug('Authenticated with socket server');
        });

        this.socket.on('unauthorized', err => {
            log.debug('Failed to authenticate with socket server', {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                error: err
            });
        });

        this.socket.on('disconnect', (reason: string) => {
            log.debug('Disconnected from socket server', { reason: reason });

            if (reason === 'io server disconnect') {
                this.socket.connect();
            }
        });

        this.mySocket = io('http://localhost:3030', {
            forceNew: true,
            autoConnect: true
        });

        this.mySocket.on('connect', () => {
            log.debug('Connected to custom autoprice socket server');
        });

        this.mySocket.on('disconnect', (reason: string) => {
            log.debug('Disconnected from custom autoprice socket server', { reason: reason });

            if (reason === 'io server disconnect') {
                this.mySocket.connect();
            }
        });

        this.mySocket.on('connect_error', (reason: string) => {
            log.warn('Cannot connect custom autoprice socket server', { reason: reason });
        });
    }

    getSchema(): SchemaManager.Schema | null {
        return this.schemaManager.schema;
    }

    getSocket(): SocketIOClient.Socket {
        return this.socket;
    }

    getMySocket(): SocketIOClient.Socket {
        return this.mySocket;
    }

    isStopping(): boolean {
        return this.stopping || this.stopRequested;
    }

    isBotReady(): boolean {
        return this.bot !== null && this.bot.isReady();
    }

    start(options: Options): Promise<void> {
        return new Promise((resolve, reject) => {
            REQUIRED_OPTS.forEach(optName => {
                if (!process.env[optName]) {
                    return reject(new Error(`Missing required environment variable "${optName}"`));
                }
            });

            async.eachSeries(
                [
                    (callback): void => {
                        log.debug('Connecting to PM2...');
                        void this.connectToPM2().asCallback(callback);
                    },
                    (callback): void => {
                        log.info('Getting TF2 schema...');
                        void this.initializeSchema().asCallback(callback);
                    },
                    (callback): void => {
                        log.info('Starting bot...');
                        this.bot = new Bot(this, options);

                        void this.bot.start().asCallback(callback);
                    }
                ],
                (item, callback) => {
                    if (this.isStopping()) {
                        // Shutdown is requested, stop the bot
                        this.stop(null, false, false);
                        return;
                    }

                    item(callback);
                },
                err => {
                    if (err) {
                        return reject(err);
                    }

                    if (this.isStopping()) {
                        // Shutdown is requested, stop the bot
                        this.stop(null, false, false);
                        return;
                    }

                    // Connect to socket server
                    this.socket.open();

                    return resolve();
                }
            );
        });
    }

    stop(err: Error | null, checkIfReady = true, rudely = false): void {
        log.debug('Shutdown has been initialized, stopping...', { err: err });

        this.stopRequested = true;
        this.stopRequestCount++;

        if (this.stopRequestCount >= 10) {
            rudely = true;
        }

        if (rudely) {
            log.warn('Forcefully exiting');
            this.exit(err);
            return;
        }

        if (err === null && checkIfReady && this.bot !== null && !this.bot.isReady()) {
            return;
        }

        if (this.stopping) {
            // We are already shutting down
            return;
        }

        this.stopping = true;

        this.cleanup();

        // TODO: Check if a poll is being made before stopping the bot

        if (this.bot === null) {
            log.debug('Bot instance was not yet created');
            this.exit(err);
            return;
        }

        this.bot.handler.onShutdown().finally(() => {
            log.debug('Handler finished cleaning up');
            this.exit(err);
        });
    }

    stopProcess(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (process.env.pm_id === undefined) {
                this.stop(null);
                return resolve();
            }

            log.warn('Stop has been requested, stopping...');

            pm2.stop(process.env.pm_id, err => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }

    restartProcess(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (process.env.pm_id === undefined) {
                return resolve(false);
            }

            // TODO: Make restart function take arguments, for example, an option to update the environment variables

            log.warn('Restart has been initialized, restarting...');

            pm2.restart(process.env.pm_id, err => {
                if (err) {
                    return reject(err);
                }

                return resolve(true);
            });
        });
    }

    private cleanup(): void {
        if (this.bot !== null) {
            // Make the bot snooze on Steam, that way people will know it is not running
            this.bot.client.setPersona(EPersonaState.Snooze);
            this.bot.client.autoRelogin = false;

            // Stop polling offers
            this.bot.manager.pollInterval = -1;

            // Stop updating schema
            clearTimeout(this.schemaManager._updateTimeout);
            clearInterval(this.schemaManager._updateInterval);

            // Stop heartbeat and inventory timers
            clearInterval(this.bot.listingManager._heartbeatInterval);
            clearInterval(this.bot.listingManager._inventoryInterval);
        }

        // Disconnect from socket server to stop price updates
        this.socket.disconnect();
    }

    private exit(err: Error | null): void {
        if (this.exiting) {
            return;
        }

        this.exiting = true;

        if (this.bot !== null) {
            this.bot.manager.shutdown();
            this.bot.listingManager.shutdown();
            this.bot.client.logOff();
        }

        log.debug('Waiting for files to be saved');
        void waitForWriting().then(() => {
            log.debug('Done waiting for files');

            log.on('finish', () => {
                // Logger has finished, exit the process
                process.exit(err ? 1 : 0);
            });

            log.warn('Exiting...');

            // Stop the logger
            log.end();
        });
    }

    connectToPM2(): Promise<void> {
        return new Promise((resolve, reject) => {
            pm2.connect(err => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }

    initializeSchema(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.schemaManager.init(err => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }
}
