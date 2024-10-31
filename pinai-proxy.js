const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const { HttpsProxyAgent } = require('https-proxy-agent');
const printLogo = require('./src/logo');

class Pinai {
    constructor() {
        this.headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://web.pinai.tech",
            "Referer": "https://web.pinai.tech/",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
            "Lang": "vi"
        };
        this.tokenFilePath = path.join(__dirname, 'token.json');
        this.proxyList = this.loadProxies();
    }

    loadProxies() {
        try {
            const proxyFile = path.join(__dirname, 'proxy.txt');
            return fs.readFileSync(proxyFile, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);
        } catch (error) {
            this.log(`Error reading proxy file: ${error.message}`, 'error');
            return [];
        }
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent,
                timeout: 10000
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Unable to check proxy IP. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error checking proxy IP: ${error.message}`);
        }
    }

    createAxiosInstance(proxy) {
        const proxyAgent = new HttpsProxyAgent(proxy);
        return axios.create({
            httpsAgent: proxyAgent,
            timeout: 30000,
            headers: this.headers
        });
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [*] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;
            case 'error':
                console.log(`[${timestamp}] [!] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [*] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [*] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Waiting ${i} seconds to continue...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }

    isExpired(token) {
        const [header, payload, sign] = token.split('.');
        const decodedPayload = Buffer.from(payload, 'base64').toString();
        
        try {
            const parsedPayload = JSON.parse(decodedPayload);
            const now = Math.floor(DateTime.now().toSeconds());
            
            if (parsedPayload.exp) {
                const expirationDate = DateTime.fromSeconds(parsedPayload.exp).toLocal();
                this.log(`Token expired on: ${expirationDate.toFormat('yyyy-MM-dd HH:mm:ss')}`.cyan);
                
                const isExpired = now > parsedPayload.exp;
                this.log(`Has the token expired? ${isExpired ? 'Yes, you need to refresh the token' : 'No, the token is still valid'}`.cyan);
                
                return isExpired;
            } else {
                this.log(`Token is perpetual and cannot determine expiration date`.yellow);
                return false;
            }
        } catch (error) {
            this.log(`Error checking token: ${error.message}`.red, 'error');
            return true;
        }
    }

    async loginToPinaiAPI(initData, proxy) {
        const url = "https://prod-api.pinai.tech/passport/login/telegram";
        const payload = {
            "invite_code": "p58M33h",
            "init_data": initData
        };

        try {
            const axiosInstance = this.createAxiosInstance(proxy);
            const response = await axiosInstance.post(url, payload);
            if (response.status === 200) {
                const { access_token } = response.data;
                this.log(`Login successful, saving token...`, 'success');
                return access_token;
            } else {
                this.log(`Login failed: ${response.data.msg}`, 'error');
                return null;
            }
        } catch (error) {
            this.log(`Error calling API: ${error.message}`, 'error');
            return null;
        }
    }

    saveAccessToken(userId, token) {
        let tokenData = {};

        if (fs.existsSync(this.tokenFilePath)) {
            tokenData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8'));
        }

        tokenData[userId] = { access_token: token };
        fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokenData, null, 2));
        this.log(`Token saved for account ${userId}`, 'success');
    }

    async getHomeData(token, hoinangcap, proxy) {
        const url = "https://prod-api.pinai.tech/home";
        const axiosInstance = this.createAxiosInstance(proxy);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        try {
            const response = await axiosInstance.get(url);
            if (response.status === 200) {
                const { pin_points, coins, current_model, data_power } = response.data;

                this.log(`Current model: ${current_model.name}`, 'custom');
                this.log(`Current level: ${current_model.current_level}`, 'custom');
                this.log(`Data Power: ${data_power}`, 'custom');
                this.log(`Balance: ${pin_points}`, 'success');

                const coinToCollect = coins.find(c => c.type === "Telegram");
                if (coinToCollect && coinToCollect.count > 0) {
                    await this.collectCoins(token, coinToCollect, proxy);
                }

                if (hoinangcap) {
                    await this.checkAndUpgradeModel(token, pin_points, current_model.current_level, proxy);
                }
            }
        } catch (error) {
            this.log(`Error calling home API: ${error.message}`, 'error');
        }
    }

    async checkAndUpgradeModel(token, currentPoints, currentLevel, proxy) {
        const url = "https://prod-api.pinai.tech/model/list";
        const axiosInstance = this.createAxiosInstance(proxy);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;

        try {
            const response = await axiosInstance.get(url);
            if (response.status === 200) {
                const { cost_config } = response.data;
                
                const nextLevelCost = cost_config.find(config => config.level === currentLevel + 1);
                
                if (nextLevelCost) {
                    const numericPoints = this.parsePoints(currentPoints);
                    
                    if (numericPoints >= nextLevelCost.cost) {
                        await this.upgradeModel(token, currentLevel + 1, proxy);
                    } else {
                        this.log(`Insufficient balance to upgrade to level ${currentLevel + 1}. Need ${nextLevelCost.cost_display} points`, 'warning');
                    }
                }
            }
        } catch (error) {
            this.log(`Error checking upgrade capability: ${error.message}`, 'error');
        }
    }

    parsePoints(points) {
        if (typeof points === 'number') return points;
        
        const multipliers = {
            'K': 1000,
            'M': 1000000
        };

        let numericValue = points.replace(/[,]/g, '');
        
        for (const [suffix, multiplier] of Object.entries(multipliers)) {
            if (points.includes(suffix)) {
                numericValue = parseFloat(points.replace(suffix, '')) * multiplier;
                break;
            }
        }

        return parseFloat(numericValue);
    }

    async upgradeModel(token, newLevel, proxy) {
        const url = "https://prod-api.pinai.tech/model/upgrade";
        const axiosInstance = this.createAxiosInstance(proxy);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;

        try {
            const response = await axiosInstance.post(url, {});
            if (response.status === 200) {
                this.log(`Model upgraded successfully to level ${newLevel}`, 'success');
            }
        } catch (error) {
            this.log(`Error upgrading model: ${error.message}`, 'error');
        }
    }

    async collectCoins(token, coin, proxy) {
        const url = "https://prod-api.pinai.tech/home/collect";
        const axiosInstance = this.createAxiosInstance(proxy);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const payload = [{ type: coin.type, count: coin.count }];

        try {
            while (coin.count > 0) {
                const response = await axiosInstance.post(url, payload);
                if (response.status === 200) {
                    coin.count = response.data.coins.find(c => c.type === "Telegram").count;
                    this.log(`Collected coins successfully, remaining: ${coin.count}`, 'success');

                    if (coin.count === 0) break;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    this.log(`Error collecting coins: ${response.statusText}`, 'error');
                    break;
                }
            }
            this.log("Collected all coins.", 'success');
        } catch (error) {
            this.log(`Error calling collect API: ${error.message}`, 'error');
        }
    }
    
    async getTasks(token, proxy) {
        const url = "https://prod-api.pinai.tech/task/list";
        const axiosInstance = this.createAxiosInstance(proxy);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        try {
            const response = await axiosInstance.get(url);
            if (response.status === 200) {
                const { tasks } = response.data;

                for (const task of tasks) {
                    if (task.task_id === 1001 && task.checkin_detail.is_today_checkin === 0) {
                        await this.completeTask(token, task.task_id, "Daily check-in successful", proxy);
                    } else if (task.is_complete === false) {
                        await this.completeTask(token, task.task_id, `Task ${task.task_name} completed successfully | Reward: ${task.reward_points}`, proxy);
                    }
                }
            }
        } catch (error) {
            this.log(`Error calling task list API: ${error.message}`, 'error');
        }
    }

    async completeTask(token, taskId, successMessage, proxy) {
        const url = `https://prod-api.pinai.tech/task/${taskId}/complete`;
        const axiosInstance = this.createAxiosInstance(proxy);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        try {
            const response = await axiosInstance.post(url, {});
            if (response.status === 200 && response.data.status === "success") {
                this.log(successMessage, 'success');
            } else {
                this.log(`Failed to complete task ${taskId}: ${response.statusText}`, 'error');
            }
        } catch (error) {
            this.log(`Error calling complete task API: ${error.message}`, 'error');
        }
    }

    askQuestion(query) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise(resolve => rl.question(query, ans => {
            rl.close();
            resolve(ans);
        }));
    }
    
    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        printLogo();
    
        const upgradePrompt = await this.askQuestion('Do you want to upgrade the model? (y/n): ');
        const shouldUpgrade = upgradePrompt.toLowerCase() === 'y';

        const tokenData = fs.existsSync(this.tokenFilePath) ? 
            JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8')) : {};
        
        while (true) {
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const userId = userData.id;
                const proxy = this.proxyList[i] || this.proxyList[0];

                let proxyIP = "Unknown";
                try {
                    proxyIP = await this.checkProxyIP(proxy);
                } catch (error) {
                    this.log(`Error checking proxy IP: ${error.message}`, 'warning');
                    continue;
                }

                console.log(`========== Account ${i + 1} | IP: ${proxyIP} ==========`);

                if (!tokenData[userId] || this.isExpired(tokenData[userId].access_token)) {
                    this.log(`Invalid or expired token for account ${userId}. Logging in again...`, 'warning');
                    const newToken = await this.loginToPinaiAPI(initData, proxy);
                    
                    if (newToken) {
                        this.saveAccessToken(userId, newToken);
                        await this.getHomeData(newToken, shouldUpgrade, proxy);
                        await this.getTasks(newToken, proxy);
                    }
                } else {
                    this.log(`Valid token for account ${userId}. No need to login again.`, 'success');
                    await this.getHomeData(tokenData[userId].access_token, shouldUpgrade, proxy);
                    await this.getTasks(tokenData[userId].access_token, proxy);
                }

                await this.countdown(3);
            }
            await this.countdown(86400);
        }
    }
}

const client = new Pinai();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});