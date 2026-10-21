import { ethers } from "ethers";

const BSC_RPC = "https://bsc-dataseed.binance.org/";
const USDT_CONTRACT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const PEPE_CONTRACT_ADDRESS = "0x...TU_CONTRATO_PEPE_AQUI..."; 

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. REGISTRO DE USUARIO (+100 PEPES bono inicio)
      if (path === "/api/register" && method === "POST") {
        const { wallet, password, referred_by } = await request.json();
        const cleanWallet = wallet.toLowerCase();

        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const passwordHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        await env.DB.prepare(
          "INSERT INTO users (wallet, password_hash, referred_by) VALUES (?, ?, ?)"
        ).bind(cleanWallet, passwordHash, referred_by ? referred_by.toLowerCase() : null).run();

        await env.DB.prepare(
          "INSERT INTO balances (wallet, pepe_balance) VALUES (?, 100.0)"
        ).bind(cleanWallet).run();

        await env.DB.prepare(
          "INSERT INTO boosts (wallet, total_usdt_deposited, daily_boost_pepe) VALUES (?, 0.0, 0.0)"
        ).bind(cleanWallet).run();

        if (referred_by) {
          await env.DB.prepare(
            "INSERT INTO referrals (referrer_wallet, referred_wallet) VALUES (?, ?)"
          ).bind(referred_by.toLowerCase(), cleanWallet).run();
        }

        return new Response(JSON.stringify({ success: true, message: "Usuario registrado con 100 PEPES de bono" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. CLAIM DIARIO (50 free + boost por USDT depositados)
      if (path === "/api/claim" && method === "POST") {
        const { wallet } = await request.json();
        const cleanWallet = wallet.toLowerCase();

        const balanceData = await env.DB.prepare("SELECT last_claim_at FROM balances WHERE wallet = ?").bind(cleanWallet).first();
        const boostData = await env.DB.prepare("SELECT daily_boost_pepe FROM boosts WHERE wallet = ?").bind(cleanWallet).first();

        if (!balanceData) {
          return new Response(JSON.stringify({ error: "Usuario no encontrado" }), { status: 404, headers: corsHeaders });
        }

        const now = new Date();
        if (balanceData.last_claim_at) {
          const lastClaim = new Date(balanceData.last_claim_at);
          const diffHours = (now - lastClaim) / (1000 * 60 * 60);
          if (diffHours < 24) {
            return new Response(JSON.stringify({ error: `Debes esperar ${Math.ceil(24 - diffHours)} horas para volver a reclamar` }), { status: 400, headers: corsHeaders });
          }
        }

        const boostAmount = boostData ? boostData.daily_boost_pepe : 0.0;
        const totalClaim = 50.0 + boostAmount;

        await env.DB.prepare(
          "UPDATE balances SET pepe_balance = pepe_balance + ?, last_claim_at = ? WHERE wallet = ?"
        ).bind(totalClaim, now.toISOString(), cleanWallet).run();

        return new Response(JSON.stringify({ success: true, claimed: totalClaim }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. VERIFICAR DEPÓSITO BLOCKCHAIN + BOOST (+2000 PEPES/USDT) + 5% REFERIDOS
      if (path === "/api/verify-deposit" && method === "POST") {
        const { wallet, tx_hash } = await request.json();
        const cleanWallet = wallet.toLowerCase();

        const existingTx = await env.DB.prepare("SELECT id FROM deposits WHERE tx_hash = ?").bind(tx_hash).first();
        if (existingTx) {
          return new Response(JSON.stringify({ error: "Transacción ya procesada previamente" }), { status: 400, headers: corsHeaders });
        }

        const provider = new ethers.JsonRpcProvider(BSC_RPC);
        const txReceipt = await provider.getTransactionReceipt(tx_hash);

        if (!txReceipt || txReceipt.status !== 1) {
          return new Response(JSON.stringify({ error: "Transacción no válida o pendiente" }), { status: 400, headers: corsHeaders });
        }

        const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, provider);
        let amountUsdt = 0;

        for (const log of txReceipt.logs) {
          if (log.address.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase()) {
            const parsedLog = usdtContract.interface.parseLog(log);
            if (parsedLog && parsedLog.name === "Transfer") {
              if (parsedLog.args.to.toLowerCase() === env.VAULT_WALLET_ADDRESS.toLowerCase()) {
                amountUsdt = parseFloat(ethers.formatUnits(parsedLog.args.value, 18));
              }
            }
          }
        }

        if (amountUsdt < 1.0) {
          return new Response(JSON.stringify({ error: "El depósito mínimo es de 1 USDT" }), { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare(
          "INSERT INTO deposits (tx_hash, wallet, amount_usdt) VALUES (?, ?, ?)"
        ).bind(tx_hash, cleanWallet, amountUsdt).run();

        const newBoostPepe = amountUsdt * 2000.0;
        await env.DB.prepare(
          "UPDATE boosts SET total_usdt_deposited = total_usdt_deposited + ?, daily_boost_pepe = daily_boost_pepe + ? WHERE wallet = ?"
        ).bind(amountUsdt, newBoostPepe, cleanWallet).run();

        const user = await env.DB.prepare("SELECT referred_by FROM users WHERE wallet = ?").bind(cleanWallet).first();
        if (user && user.referred_by) {
          const commission = amountUsdt * 0.05;
          await env.DB.prepare(
            "UPDATE referrals SET commission_usdt = commission_usdt + ? WHERE referrer_wallet = ? AND referred_wallet = ?"
          ).bind(commission, user.referred_by, cleanWallet).run();
        }

        return new Response(JSON.stringify({ success: true, deposited_usdt: amountUsdt, added_daily_boost: newBoostPepe }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. RETIRO AUTOMÁTICO EN 1-CLICK (Mínimo 5000 PEPES)
      if (path === "/api/withdraw" && method === "POST") {
        const { wallet } = await request.json();
        const cleanWallet = wallet.toLowerCase();

        const balanceData = await env.DB.prepare("SELECT pepe_balance FROM balances WHERE wallet = ?").bind(cleanWallet).first();

        if (!balanceData || balanceData.pepe_balance < 5000.0) {
          return new Response(JSON.stringify({ error: "El retiro mínimo es de 5000 PEPES" }), { status: 400, headers: corsHeaders });
        }

        const amountToWithdraw = balanceData.pepe_balance;

        await env.DB.prepare(
          "UPDATE balances SET pepe_balance = 0.0 WHERE wallet = ?"
        ).bind(cleanWallet).run();

        const provider = new ethers.JsonRpcProvider(BSC_RPC);
        const signer = new ethers.Wallet(env.PRIVATE_KEY, provider);
        const pepeContract = new ethers.Contract(PEPE_CONTRACT_ADDRESS, ERC20_ABI, signer);

        const amountWei = ethers.parseUnits(amountToWithdraw.toString(), 18);
        const tx = await pepeContract.transfer(cleanWallet, amountWei);
        await tx.wait();

        await env.DB.prepare(
          "INSERT INTO withdrawals (wallet, amount_pepe, tx_hash, status) VALUES (?, ?, ?, 'COMPLETED')"
        ).bind(cleanWallet, amountToWithdraw, tx.hash).run();

        return new Response(JSON.stringify({ success: true, withdrawn: amountToWithdraw, tx_hash: tx.hash }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Ruta no encontrada" }), { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
