import axios from 'axios';
import { LAMPORTS_PER_SOL, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import { base58_to_binary } from 'base58-js';
import bs58 from 'bs58'
import dotenv from 'dotenv';
import promptSync from 'prompt-sync';

import { getCandyMachineAccounts, differentArrayValues, sleep, getCandyMachineState, mintOneToken } from "./helpers.js";

const prompt = promptSync({ sigint: true });
let taskCount;
let delay;
let connection;
let secretKey;
let wallet;
let bots = [];
let nft_collections = {};
let target_candy_machine_id = ""
console.log("----------------------------------------------------------------------------");
taskCount = Number(prompt("How many tasks would you like to run? "));
console.log("----------------------------------------------------------------------------");
delay = Number(prompt("What is the retry delay? "));
console.log("----------------------------------------------------------------------------");
target_candy_machine_id = String(prompt("candy-machine-id? "));
console.log("\x1b[32m%s\x1b[0m", `[${ new Date() }] Starting task...`);
console.log("\x1b[32m%s\x1b[0m", `[${ new Date() }] Connecting to the solana network...`);
connection = new anchor.web3.Connection(anchor.web3.clusterApiUrl('mainnet-beta'));
console.log("\x1b[33m%s\x1b[0m", `[${ new Date() }] Connected to cluster! VERSION: undefined`);
console.log("\x1b[32m%s\x1b[0m", `[${ new Date() }] Connecting wallet...`);

dotenv.config();

secretKey = base58_to_binary(process.env.WALLET_SECRET_KEY);
wallet = new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(secretKey));
console.log("\x1b[33m%s\x1b[0m", `[${ new Date() }] Connected wallet! ADDRESS: ${ wallet.publicKey.toString() }`);

let isFirst = true;
const createBot = async (pubkey, loaded) => {
    console.log("pubkey: ", pubkey.toString());
    bots.push(pubkey);

    let isLoaded = loaded;
    if (isLoaded) {
        console.log("**************************************************************");
        console.log("New Candy Machine Found!");
        console.log("CMID: ", pubkey.toString());
        const state = await getCandyMachineState(wallet, pubkey, connection);
        console.log(`\x1b[34m%s\x1b[0m : ${ state.state.itemsRemaining }/${ state.state.itemsAvailable }`, "Available");
        console.log(`\x1b[34m%s\x1b[0m : ${ state.state.price / LAMPORTS_PER_SOL } SOL`, "Price");
        console.log(`\x1b[34m%s\x1b[0m : ${ state.state.isActive ? "Yes" : "No" }`, "MintLive");
        console.log(`\x1b[34m%s\x1b[0m : ${ new Date(Number(state.state.goLiveDate)) }`, "goLiveDate");
        console.log(`\x1b[34m%s\x1b[0m : ${ state.state.whitelistMintSettings ? "Yes" : "No" }`, "IsWhitelist");
        console.log(`\x1b[34m%s\x1b[0m : ${ state.state.gatekeeper }`, "gateKeeper");
        mintOneToken(state, wallet.payer);
        console.log("**************************************************************");
    }

    const monitor = async () => {
        let newUrls = [];
        try {
            const accountWithData = await connection.getAccountInfo(pubkey, { encoding: "base64" });
            let data = Buffer.from(accountWithData.data, "base64").toString();

            data = data.match(/(((https?:\/\/)|(www\.))[^\s]+)/g);

            if(data && data.length) {
                data.map(url => {
                    let newUrl;
                    let nonAscPos = url.search("\x00");
                    newUrl = url.slice(0, nonAscPos != -1 ? nonAscPos : url.length);
                    newUrls.push(newUrl);
                });

                let nonAscPos = data[0].search("\x00");
                let url = data[0].slice(0, nonAscPos != -1 ? nonAscPos : data[0].length);
                try {
                    let response = await axios.get(url);
                    response = response.data;
                    let collection = response.collection.name;

                    if (collection && nftCollections[collection] == undefined) { //New Collection
                        nftCollections[collection] = {
                            "name": response.name,
                            "symbol": response.symbol,
                            "description": response.description,
                            "external_url": response.external_url,
                            "image": response.image
                        };

                        if(isLoaded && response.external_url) {
                            console.log(`${ isFirst ? ">" : " " } \x1b[34m%s\x1b[0m ${ response.external_url }`, "$scrape");
                            isFirst = false;
                        }
                    }
                } catch (e) {

                }
            }
        } catch (e) {

        } finally {
            isLoaded = true;

            setTimeout(async () => {
                await monitor();
            }, delay);
        }
    }
    await monitor();
}

const load = async () => {
    try {
        let accounts = await getCandyMachineAccounts(connection);
        for(let i = 0; i < accounts.length; i ++) {
            let account = accounts[i];
            await createBot(target_candy_machine_id !== "" ? new PublicKey(target_candy_machine_id) : account.pubkey, false);
            await sleep(delay);
        };
    } catch(e) {

    }
}

const reload = async () => {
    try {
        let newBots = await getCandyMachineAccounts(connection);
        newBots = newBots.map(account => account.pubkey);
        newBots = differentArrayValues(bots, newBots);
        for(let i = 0; i < newBots.length; i ++) {
            let bot = newBots[i];
            await createBot(target_candy_machine_id !== "" ? new PublicKey(target_candy_machine_id) : bot, true);
            await sleep(delay);
        }
    } catch (e) {

    } finally {
        await reload();
    }
}

console.log("\x1b[32m%s\x1b[0m", `[${ new Date() }] Scraping candy machines with hawk-eye...`);

load();
reload();