const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
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
            process.stdout.write(`[${timestamp}] [*] Wait ${i} seconds to continue...`);
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
                this.log(`Token expires at: ${expirationDate.toFormat('yyyy-MM-dd HH:mm:ss')}`.cyan);
                
                const isExpired = now > parsedPayload.exp;
                this.log(`Is token expired? ${isExpired ? 'Yes, you need to replace the token' : 'No... run at full speed'}`.cyan);
                
                return isExpired;
            } else {
                this.log(`Perpetual token, expiration time cannot be read`.yellow);
                return false;
            }
        } catch (error) {
            this.log(`Error checking token: ${error.message}`.red, 'error');
            return true;
        }
    }

    async loginToPinaiAPI(initData) {
        const url = "https://prod-api.pinai.tech/passport/login/telegram";
        const payload = {
            "invite_code": "p58M33h",
            "init_data": initData
        };

        try {
            const response = await axios.post(url, payload, { headers: this.headers });
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
        this.log(`Token for account ${userId} has been saved to token.json`, 'success');
    }

    async getHomeData(token, shouldUpgrade) {
        const url = "https://prod-api.pinai.tech/home";
        const headers = { ...this.headers, "Authorization": `Bearer ${token}` };
        
        try {
            const response = await axios.get(url, { headers });
            if (response.status === 200) {
                const { pin_points, coins, current_model, data_power } = response.data;

                this.log(`Current Model: ${current_model.name}`, 'custom');
                this.log(`Current Level: ${current_model.current_level}`, 'custom');
                this.log(`Data Power: ${data_power}`, 'custom');
                this.log(`Balance: ${pin_points}`, 'success');

                const coinToCollect = coins.find(c => c.type === "Telegram");
                if (coinToCollect && coinToCollect.count > 0) {
                    await this.collectCoins(token, coinToCollect);
                }

                if (shouldUpgrade) {
                    await this.checkAndUpgradeModel(token, pin_points, current_model.current_level);
                }
            } else {
                this.log(`Error getting data from API home: ${response.statusText}`, 'error');
            }
        } catch (error) {
            this.log(`Error calling API home: ${error.message}`, 'error');
        }
    }

    async checkAndUpgradeModel(token, currentPoints, currentLevel) {
        const url = "https://prod-api.pinai.tech/model/list";
        const headers = { ...this.headers, "Authorization": `Bearer ${token}` };

        try {
            const response = await axios.get(url, { headers });
            if (response.status === 200) {
                const { cost_config } = response.data;
                
                const nextLevelCost = cost_config.find(config => config.level === currentLevel + 1);
                
                if (nextLevelCost) {
                    const numericPoints = this.parsePoints(currentPoints);
                    
                    if (numericPoints >= nextLevelCost.cost) {
                        await this.upgradeModel(token, currentLevel + 1);
                    } else {
                        this.log(`Insufficient balance to upgrade to level ${currentLevel + 1}. Need ${nextLevelCost.cost_display} more points`, 'warning');
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

    async upgradeModel(token, newLevel) {
        const url = "https://prod-api.pinai.tech/model/upgrade";
        const headers = { ...this.headers, "Authorization": `Bearer ${token}` };

        try {
            const response = await axios.post(url, {}, { headers });
            if (response.status === 200) {
                this.log(`Successfully upgraded model to level ${newLevel}`, 'success');
            }
        } catch (error) {
            this.log(`Error upgrading model: ${error.message}`, 'error');
        }
    }

    async collectCoins(token, coin) {
        const url = "https://prod-api.pinai.tech/home/collect";
        const headers = { ...this.headers, "Authorization": `Bearer ${token}` };
        const payload = [{ type: coin.type, count: coin.count }];

        try {
            while (coin.count > 0) {
                const response = await axios.post(url, payload, { headers });
                if (response.status === 200) {
                    coin.count = response.data.coins.find(c => c.type === "Telegram").count;
                    this.log(`Collection successful, remaining: ${coin.count}`, 'success');

                    if (coin.count === 0) break;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    this.log(`Error collecting coins: ${response.statusText}`, 'error');
                    break;
                }
            }
            this.log("All coins have been collected.", 'success');
        } catch (error) {
            this.log(`Error calling API collect: ${error.message}`, 'error');
        }
    }
    
    async getTasks(token) {
        const url = "https://prod-api.pinai.tech/task/list";
        const headers = { ...this.headers, "Authorization": `Bearer ${token}` };
        
        try {
            const response = await axios.get(url, { headers });
            if (response.status === 200) {
                const { tasks } = response.data;

                for (const task of tasks) {
                    if (task.task_id === 1001 && task.checkin_detail.is_today_checkin === 0) {
                        await this.completeTask(token, task.task_id, "Check-in successful");
                    } else if (task.is_complete === false) {
                        await this.completeTask(token, task.task_id, `Completed task ${task.task_name}, reward: ${task.reward_points} points`);
                    }
                }
            } else {
                this.log(`Error getting task list: ${response.statusText}`, 'error');
            }
        } catch (error) {
            this.log(`Error calling API task list: ${error.message}`, 'error');
        }
    }

    async completeTask(token, taskId, successMessage) {
        const url = `https://prod-api.pinai.tech/task/${taskId}/complete`;
        const headers = { ...this.headers, "Authorization": `Bearer ${token}` };
        
        try {
            const response = await axios.post(url, {}, { headers });
            if (response.status === 200 && response.data.status === "success") {
                this.log(successMessage, 'success');
            } else {
                this.log(`Cannot complete task ${taskId}: ${response.statusText}`, 'error');
            }
        } catch (error) {
            this.log(`Error calling API complete task ${taskId}: ${error.message}`, 'error');
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
        }))
    }
    
    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);
        printLogo();
    
        const upgradeAnswer = await this.askQuestion('Do you want to upgrade the model? (y/n): ');
        const shouldUpgrade = upgradeAnswer.toLowerCase() === 'y';

        const tokenData = fs.existsSync(this.tokenFilePath) ? JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf8')) : {};
        while (true) {
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const userId = userData.id;

                console.log(`========== Account ${i + 1} ==========`);

                if (!tokenData[userId] || this.isExpired(tokenData[userId].access_token)) {
                    this.log(`Invalid or expired token for account ${userId}. Logging in again...`, 'warning');
                    const newToken = await this.loginToPinaiAPI(initData);
                    
                    if (newToken) {
                        this.saveAccessToken(userId, newToken);
                        await this.getHomeData(newToken, shouldUpgrade);
                        await this.getTasks(newToken);
                    }
                } else {
                    this.log(`Valid token for account ${userId}. No need to login again.`, 'success');
                    await this.getHomeData(tokenData[userId].access_token, shouldUpgrade);
                    await this.getTasks(tokenData[userId].access_token);
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