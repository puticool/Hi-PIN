
![c406419e-b918-40ba-aa40-ad91b9112f67](https://github.com/user-attachments/assets/700cd9df-0d76-451b-9321-7c16e0d80af2)

✔️ Auto tap

✔️ Auto task

✔️ Auto upgrade

✔️ Multi-threading support

# 🛠️ Instructions:

## REQUIREMENTS: NODEJS MUST BE INSTALLED

Run the following command to install the necessary modules:

`npm install`

Create two files: [data.txt](data.txt) and [proxy.txt](proxy.txt)

For those using multiple accounts, it's recommended to use a proxy (if using only one account, there's no need to create the proxy.txt file).

# Proxy format:

http://user:pass@ip:port

# Get data:

In the data.txt file, you need to have the following format:

query_id=xxx or user=xxxx

![Capture](https://github.com/user-attachments/assets/6db0b3ed-86fe-4cf7-b9c3-9dde4c0f2efb)


# Run the tool using the command:

noproxy:

`node pinai.js`

proxy:

`node pinai-proxy.js`

multi-threading + proxy:

`node pinai-thread.js`
