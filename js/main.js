var astApiDir='/allscan/astapi/';
var statsDir='/allscan/stats/';
var apiDir='/allscan/api/';
var source, xh, hbcnt=0, xha, favsCnt=0, xhs, xhr;
var rldRetries=0, rldTmr;
var statsTmr, statsState=0, statsIdx=0, statsReqCnt=0, txCnt=[], txTim=[], txTT=[];
// DOM elements
var hb, lnode, rnode, conncnt, ftbl, statmsg, scanmsg, cputemp, pgTitle;

function asInit(url) {
	if(typeof(EventSource) === 'undefined') {
		alert("ERROR: Your browser does not support server-sent events.");
		return;
	}
	hb = document.getElementById('hb');
	lnode = document.getElementById('localnode');
	rnode = document.getElementById('node');
	conncnt = document.getElementById('conncnt');
	ftbl = document.getElementById('favs');
	statmsg = document.getElementById('statmsg');
	scanmsg = document.getElementById('scanmsg');
	cputemp = document.getElementById('cputemp');
	pgTitle = document.title;
	// Start SSE
	source = new EventSource(astApiDir + url);
	source.onerror = handleEventSourceError;
	// Close event stream on exit
	window.addEventListener('beforeunload', function() { source.close(); });
	// Handle node data, update whole Conn Status table
	source.addEventListener('nodes', handleNodesEvent, false);
	// Handle nodetimes data, update Conn Status time columns
	source.addEventListener('nodetimes', handleNodetimesEvent, false);
	// Handle connection data
	source.addEventListener('connection', handleConnectionEvent, false);
	// Handle error responses
	source.addEventListener('errMsg', handleErrMsgEvent, false);
	// Handle offline/online events
	window.addEventListener('online', handleOnlineEvent);
	window.addEventListener('offline', handleOfflineEvent);
	// Init ASL stats & API functions
	statsTmr = setTimeout(getStats, 250);
}

function getStats() {
	// ASL API request limit is 30 reqs/minute. In case more than one node is on this server ideally do no
	// more than one req per 4 secs and increase that time if any requests return an error.
	var rnodes=[], node;
	switch(statsState) {
		case 0: // init
			// Parse favorites table for node numbers
			for(var r=1, i=0; r < ftbl.rows.length; r++) {
				//for(var c=0, m=ftbl.rows[r].cells.length; c < m; c++) {
				node = ftbl.rows[r].cells[1].innerHTML
				if(node >= 2000 && node < 3000000) // Skip EchoLink / invalid node#s
					rnodes[i++] = ftbl.rows[r].cells[1].innerHTML;
			}
			favsCnt = rnodes.length;
			if(favsCnt == 0) {
				return;
			}
			if(statsIdx >= favsCnt)
				statsIdx=0;
			var node = rnodes[statsIdx];
			//statMsg('Requesting ASL Stats for ' + node + '...');
			//var parms = 'node=' + rnodes.join(',');
			var parms = 'node=' + node;
			xhttpStatsInit(statsDir + 'stats.php', parms);
			statsReqCnt++;
			break;
	}
}
function xhttpStatsInit(url, parms) {
	xhs = new XMLHttpRequest();
	xhs.onreadystatechange = handleStatsResponse;
	xhs.open('POST', url, true);
	xhs.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
	xhs.send(parms);
}
function handleStatsResponse() {
	if(xhs.readyState != 4) {
		return;
	}
	if(xhs.status == 200) {
		// statMsg('statsResponse: ' + xhs.responseText);
		var resp = JSON.parse(xhs.responseText);
		// Data structure: event=stats; status=LogMsg; stats=statsStruct
		var e = resp.event;
		if(resp.data.stats === undefined) {
			if(resp.data.retcode == 404) {
				scanMsg('ASL Stats 404 response for node '+resp.data.node+'. Check node number.');
				statsIdx++;
				statsTmr = setTimeout(getStats, calcReqIntvl());
				return;
			}
			if(resp.data.retcode != 429) {
				scanMsg(resp.data.status + '. Will retry in 15 Seconds...');
				statsIdx++;
			}
			statsTmr = setTimeout(getStats, 15000);
			return;
		}
		statsIdx++;
		var s = resp.data.stats;
		var time = unixtime();
		var row;
		// Update favs table
		for(var r=0, n=ftbl.rows.length-1; r < n; r++) {
			//for(var c=0, m=ftbl.rows[r].cells.length; c < m; c++) {
			var cells = ftbl.rows[r+1].cells;
			var node = cells[1].innerHTML;
			if(node != s.node)
				continue;
			// Colors: Tx=maroon Busy=0-50% green LinkCnt:0-50% blue
			// Cols #:Tx/Act/NotAct LCnt:linkCnt (Blue 0-50) Bsy%:busyPct (Green 0-50)
			var c0 = cells[0];
			if(!txCnt[node] || s.keyups < txCnt[node] || s.txtime < txTT[node]) {
				txCnt[node] = s.keyups;
				txTim[node] = 0;
				txTT[node] = s.txtime;
			}
			var txd = s.keyups - txCnt[node];
			var ttd = s.txtime - txTT[node];
			var s2 = (txd || ttd) ? (' &Delta;TxC=' + txd + ' &Delta;TxT=' + ttd) : '';
			scanMsg(c0.innerHTML + ': ' + resp.data.status + s2);
			if(s.keyed == 1 || (txd > 0 && ttd > 10))
				txTim[node] = time;
			// Show # col in red if keyed or txcnt diff > 1, show in darker red if txd > 0 or was keyed in past 2 mins
			if(s.keyed == 1 || txd > 1 || ttd > 20)
				c0.className = 'tColor';
			else if(time - txTim[node] < 120)
				c0.className = 't2Color';
			else if(s.active == 1)
				c0.className = (s.wt == 1) ? 'wColor' : 'gColor';
			else
				c0.className = '';
			// Color Rx% column green, max 50%
			var busy = cells[5];
			var grn = Math.round(Math.log(3 + s.busyPct) * 5);
			if(grn > 50)
				grn = 50;
			busy.innerHTML = s.busyPct;
			busy.style.backgroundColor = (s.busyPct > 5) ? 'hsl(150,50%,'+grn+'%)' : 'transparent';
			// Color LCnt column blue, max 50% = 50 links
			var lcnt = cells[6];
			var blue = Math.round(Math.log(3 + s.linkCnt) * 8);
			if(blue > 30)
				blue = 30;
			lcnt.innerHTML = s.linkCnt;
			lcnt.style.backgroundColor = (s.linkCnt > 3) ? 'hsl(240,40%,'+blue+'%)' : 'transparent';
			// Store last Tx Cnt & total time to support more reliable keyed status detection
			txCnt[node] = s.keyups;
			txTT[node] = s.txtime;
		}
		statsTmr = setTimeout(getStats, calcReqIntvl());
	} else {
		statMsg('/stats/ HTTP error ' + xhs.status + '. Retrying in 60 Secs...');
		statsTmr = setTimeout(getStats, 60000);
	}
}
function calcReqIntvl() {
	// Do initial stats requests quickly to populate Favs table then reduce request rate so if multiple
	// clients are using the node the ASL stats request limit (30/min) will be less likely to be exceeded
	var t = 1000;
	if(statsReqCnt > 9000)
		t = 10000; // 6/min after 12hrs
	else if(statsReqCnt > 4000)
		t = 6000; // 10/min after 4hrs
	else if(statsReqCnt > 600)
		t = 4000; // 15/min after 30min
	else if(statsReqCnt > favsCnt || statsReqCnt > 25)
		t = 3000; // 20/min after initial scan
	return t;
}

function handleEventSourceError(event) {
	if(event !== null && typeof event === 'object')
		event = JSON.stringify(event);
	var msg = (event === '{"isTrusted":true}') ? 'Check internet/LAN connections and power to node' : event;
	msg = 'Event Source error: ' + msg;
	statMsg(msg);
	statMsg('Reloading in 15 Seconds...');
	rldTmr = setTimeout(reloadPage, 15000);
	if(statsTmr !== undefined)
		clearTimeout(statsTmr);
}

function handleOnlineEvent() {
	statMsg('Online event received. Reloading...');
	rldTmr = setTimeout(reloadPage, 2500);
}
function handleOfflineEvent() {
	statMsg('Offline event received.');
	rldRetries=0;
	if(rldTmr !== undefined)
		clearTimeout(rldTmr);
	if(statsTmr !== undefined)
		clearTimeout(statsTmr);
}
function reloadPage() {
	// Verify node is accessible before reloading
	if(rldRetries == 0)
		statMsg('Verifying node is accessible...');
	xhr = new XMLHttpRequest();
	xhr.open('GET', window.location.href, true);
	xhr.onreadystatechange = handleXRldResp;
	xhr.send();
}
function handleXRldResp() {
	if(xhr.status == 200) {
		xhr.abort();
		rldRetries = 0;
		// .assign & href prevents POST data resubmit
		window.location.assign(window.location.href);
	} else if(xhr.readyState === 4) {
		rldRetries++;
		var s = xhr.status > 0 ? ' (stat=' + xhr.status + ')' : '';
		if(rldRetries < 8) { // Try again after a delay
			var t = 2 + 2 * rldRetries;
			statMsg(`Node unreachable${s}, will retry in ${t} Secs...`);
			rldTmr = setTimeout(reloadPage, t * 1000);
		} else if(rldRetries < 23) {
			statMsg(`Node unreachable${s}. Retrying in 60 Secs...`);
			rldTmr = setTimeout(reloadPage, 60000);
		} else {
			statMsg('Node unreachable. Check internet/LAN connections and power to node. '
				+ 'Reload this page when node is online.');
		}
	} else {
		statMsg(`RldResp: {xhr.readyState}, {xhr.status}`);
	}
}

function statMsg(msg) {
	if(statmsg.innerHTML.length > 50000)
		statmsg.innerHTML = '';
	statmsg.innerHTML = (statmsg.innerHTML === '') ? msg : (statmsg.innerHTML + '<br>' + msg);
	statmsg.scrollTop = statmsg.scrollHeight;
}
function clearStatMsg() {
	statmsg.innerHTML = '';
}
function scanMsg(msg) {
	scanmsg.innerHTML = msg;
}

function handleErrMsgEvent(event) {
	var data = JSON.parse(event.data);
	statMsg('ERROR: ' + data.status);
}
function handleConnectionEvent(event) {
	var data = JSON.parse(event.data);
	statMsg(data.status);
	//console.log('ConnectionEvent: ' + data.status);
	if(!data.node)
		return;
	tableID = 'table_' + data.node;
	//$('#' + tableID + ' tbody:first').html('<tr><td colspan="6">' + data.status + '</td></tr>');
	const cstbl = document.getElementById(tableID);
	var tbody0 = cstbl.getElementsByTagName('tbody')[0];
	tbody0.innerHTML = '<tr><td colspan="6">' + data.status + '</td></tr>';
}
function handleNodesEvent(event) {
	var tabledata = JSON.parse(event.data);
	for(var localNode in tabledata) {
		var tablehtml = '';
		var total_nodes = 0;
		var cos_keyed = 0;
		var tx_keyed = 0;
		var pgTitlePrefix = '';
		for(row in tabledata[localNode].remote_nodes) {
			var rowdata = tabledata[localNode].remote_nodes[row];
			if(rowdata.cos_keyed == 1)
				cos_keyed = 1;
			if(rowdata.tx_keyed == 1)
				tx_keyed = 1;
		}
		if(cos_keyed == 0) {
			if(tx_keyed == 0) {
				tablehtml += '<tr class="gColor"><td>' + localNode + '</td><td>Idle</td><td colspan="4"></td></tr>';
			} else {
				tablehtml += '<tr class="tColor"><td>' + localNode + '</td><td>PTT-Keyed</td><td colspan="4"></td></tr>';
				pgTitlePrefix = '\u{1F534} '; // Red Circle
			}
		} else {
			if(tx_keyed == 0) {
				tablehtml += '<tr class="lColor"><td>' + localNode + '</td><td>COS-Detected</td><td colspan="4"></td></tr>';
				pgTitlePrefix = '\u{1F7E2} '; // Green Circle
			} else {
				tablehtml += '<tr class="bColor"><td>' + localNode +
					'</td><td colspan="2">COS-Detected, PTT-Keyed</td><td colspan="4"></td></tr>';
				pgTitlePrefix = '\u{1F7E1} '; // Orange Circle
			}
		}
		for(row in tabledata[localNode].remote_nodes) {
			var rowdata = tabledata[localNode].remote_nodes[row];
			if(rowdata.info === 'NO CONNECTION') {
				tablehtml += '<tr><td colspan="6">No Connections</td></tr>';
			} else {
				nodeNum = rowdata.node;
				if(nodeNum != 1) {
					total_nodes++
					// Set background color
					if(rowdata.keyed == 'yes') {
						tablehtml += '<tr class="rColor">';
					} else if(rowdata.mode == 'C') {
						tablehtml += '<tr class="cColor">';
					} else {
						tablehtml += '<tr>';
					}
					var id = 't' + localNode + 'c0' + 'r' + row;
					tablehtml += '<td id="' + id + '" class="nodeNum" onClick="setNodeBox(' + nodeNum + ')">' +
						nodeNum + '</td>';
					// Show info or IP
					if(rowdata.info != "") {
						tablehtml += '<td>' + rowdata.info + '</td>';
					} else {
						tablehtml += '<td>' + rowdata.ip + '</td>';
					}
					tablehtml += '<td id="lkey' + row + '">' + rowdata.last_keyed + '</td>';
					// Link col is redundant. Connected col value makes clear if Link is Connecting/Established
					// tablehtml += '<td>' + rowdata.link + '</td>';
					tablehtml += '<td>' + rowdata.direction + '</td>';
					tablehtml += '<td id="elap' + row +'">' +
						rowdata.elapsed + '</td>';
					// Show mode
					if(rowdata.mode == 'R') {
						tablehtml += '<td>Receive Only</td>';
					} else if(rowdata.mode == 'T') {
						tablehtml += '<td>Transceive</td>';
					} else if(rowdata.mode == 'C') {
						tablehtml += '<td>Connecting</td>';
					} else {
						tablehtml += '<td>' + rowdata.mode + '</td>';
					}
					tablehtml += '</tr>';
				}
			}
		}
		// Display Count
		if(total_nodes > 1) {
			tablehtml += '<tr><td colspan="6">' + total_nodes + ' nodes connected</td></tr>';
		}
		// $('#table_' + localNode + ' tbody:first').html(tablehtml);
		const cstbl = document.getElementById('table_' + localNode);
		tbody0 = cstbl.getElementsByTagName('tbody')[0];
		tbody0.innerHTML = tablehtml;
		if(conncnt)
			conncnt.value = total_nodes;
		document.title = pgTitlePrefix + pgTitle;
	}
}
function handleNodetimesEvent(event) {
	var tabledata = JSON.parse(event.data);
	for(localNode in tabledata) {
		tableID = 'table_' + localNode;
		cstbl = document.getElementById(tableID);
		for(row in tabledata[localNode].remote_nodes) {
			var rowdata = tabledata[localNode].remote_nodes[row];
			rowID='lkey' + row;
			//$( '#' + tableID + ' #' + rowID).text( rowdata.last_keyed );
			tableRow = document.getElementById(rowID);
			if(tableRow !== null)
				tableRow.innerHTML = rowdata.last_keyed; // Received

			rowID='elap' + row;
			//$( '#' + tableID + ' #' + rowID).text( rowdata.elapsed );
			tableRow = document.getElementById(rowID);
			if(tableRow !== null)
				tableRow.innerHTML = rowdata.elapsed; // Connected
		}
	}
	hb.style.visibility = (hb.style.visibility == 'visible') ? "hidden" : "visible";
	// Update CPU Temp once per ~minute
	if(cputemp && ++hbcnt % 120 == 0)
		xhttpApiInit('f=getCpuTemp');
}

function xhttpApiInit(parms) {
	xha = new XMLHttpRequest();
	xha.onreadystatechange = handleApiResponse;
	xha.open('POST', apiDir, true);
	xha.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
	xha.send(parms);
}
function handleApiResponse() {
	if(xha.readyState === 4) {
		if(xha.status === 200) {
			// statMsg('statsResponse: ' + xha.responseText);
			var resp = JSON.parse(xha.responseText);
			// Data structure: event=API function (getCpuTemp); status=LogMsg; data=result
			var e = resp.event;
			if(resp.data === undefined) {
				statMsg('API function' + e + ': No data.');
				return;
			}
			var s = resp.data;
			// Update cputemp span
			if(cputemp)
				cputemp.innerHTML = s.data;
		} else {
			statMsg('/api/ HTTP error ' + xha.status + '.');
		}
	}
}

function connectNode(button) {
	var localNode = lnode.value;
	var remoteNode = rnode.value;
	if(remoteNode < 1) {
		alert('Please enter a valid remote node number.');
		return;
	}
	var perm = document.getElementById('permanent').checked;
	// Disconnect before Connect checkbox. Only applies if conncnt > 0
	var autodisc = document.getElementById('autodisc').checked;
	if(conncnt.value < 1)
		autodisc = false;
	parms = 'remotenode='+remoteNode + '&perm='+perm + '&button='+button + '&localnode='+localNode + '&autodisc='+autodisc;
	xhttpSend(astApiDir + 'connect.php', parms);
}
function disconnectNode() {
	var localNode = lnode.value;
	var remoteNode = rnode.value;
	if(remoteNode.length == 0) {
		alert('Please enter the remote node number.');
		return;
	}
	var perm = document.getElementById('permanent').checked;
	parms = 'remotenode='+remoteNode + '&perm='+perm + '&button=disconnect' + '&localnode='+localNode;
	xhttpSend(astApiDir + 'connect.php', parms);
}
function dtmfCmd() {
	var localNode = lnode.value;
	var cmd = rnode.value;
	if(cmd.length == 0) {
		alert('Please enter a valid DTMF command in the Node# field.');
		return;
	}
	parms = 'button=dtmf' + '&cmd='+cmd + '&localnode='+localNode;
	xhttpSend(astApiDir + 'cmd.php', parms);
}
function astrestart() {
	var localNode = lnode.value;
	parms = 'button=restart' + '&localnode='+localNode;
	xhttpSend(astApiDir + 'cmd.php', parms);
	// Reload page
	statMsg("Reloading in 500mS...");
	setTimeout(function() { window.location.assign(window.location.href); }, 500);
}
function xhttpSend(url, parms) {
	xh = new XMLHttpRequest();
	xh.onreadystatechange = handleXhttpResponse;
	xh.open('POST', url, true);
	xh.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
	xh.send(parms);
}
function handleXhttpResponse() {
	if(xh.readyState === 4) {
		if(xh.status === 200) {
			statMsg(xh.responseText);
		} else {
			statMsg('Error response from server: ' + xh.status);
		}
	}
}

function setNodeBox(n) {
	rnode.value = n;
}
function unixtime() {
	return Math.floor(Date.now() / 1000);
}
function varDump(v) {
	const logLines = ["Property (Typeof): Value", `Var (${typeof v}): ${v}`];
	for(const prop in v)
		logLines.push(`${prop} (${typeof v[prop]}): ${v[prop] || "n/a"}`);
	console.log(logLines.join("\n"));
}
