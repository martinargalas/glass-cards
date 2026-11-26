// The demo's music: three speakers, and YouTube Music as the library they play from – a snapshot
// of a real YouTube Music home (its rows and covers, as Home Assistant's YouTube Music integration
// browses them). Nothing is ever played: the speakers only say they play.
type Attrs = Record<string, any>;
type DemoState = string | [string, Attrs];

/** A snapshot of YouTube Music's library, as `media_player/browse_media` answers it. */
export const YTM_LIBRARY: Record<string, any> = {"home|":{"title":"Home","media_class":"directory","media_content_type":"home","media_content_id":"","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Today's biggest hits","media_class":"playlist","media_content_type":"home2","media_content_id":"Today's biggest hits","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/JhukEr_gsgy7LuD0aFWmmTpcrAkB0Amk5zoFgAtPE3LBWwRXfbkZPP3epGFAp9HLcNkVZ-AyD0kX-a7e=w544-h544-l90-rj"},{"title":"All hits","media_class":"playlist","media_content_type":"home2","media_content_id":"All hits","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/p2FmWBFqHEbEc8S-T-19oIt0saD5sc2r7lwtgxxaKNulklqdmWUVtOShVLA6X-0-bVCjOlNr3jzixQ=w544-h544-l90-rj"},{"title":"Trending songs for you","media_class":"playlist","media_content_type":"home2","media_content_id":"Trending songs for you","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/bBZfYsRKPIu5esakP9qq5qVLu_unNsAn8zPYOwurEem14CLpHsKbUOme2Wnv6B9KYraeHW7GFMW9Zlg=w544-h544-l90-rj"},{"title":"Music videos for you","media_class":"playlist","media_content_type":"home2","media_content_id":"Music videos for you","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://i.ytimg.com/vi/3DcoC8p9az8/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3nXjjpO-FKPYZlsQJctsBsCEeZFSA"},{"title":"Covers and remixes","media_class":"playlist","media_content_type":"home2","media_content_id":"Covers and remixes","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/VMVJXxPN4zR2XFumd_ha6Siv27k2zFwViSm9kcXdUQdoABVYZcKgi-0F15dXkLMbL9bsN3zwCBrlsPVC=w544-h544-l90-rj"},{"title":"Song mixes","media_class":"playlist","media_content_type":"home2","media_content_id":"Song mixes","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/_cBCKUoFjuJsTPKvNViql9pqLTD_NfiNNn3y13rh1iXXIwpZ2dyQcyn9H2dneW9J9F9-I6zM13zFe4qV=w544-h544-l90-rj"},{"title":"New releases","media_class":"playlist","media_content_type":"home2","media_content_id":"New releases","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/d6-E1VvQ1BQoNpKG2L3OVLNai9V7tnwu87doTmUNKdg5FC3Bh_NejaWpsS4Fjgt9kUhQ1GbP6chKSEppmw=w544-h544-l90-rj"},{"title":"Live performances","media_class":"playlist","media_content_type":"home2","media_content_id":"Live performances","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/AKOi8e955qeoo82rZTlkDwCYgNZP6e02k5Cr1BRvzcAHMOYbQ7w1f1GrK2eVqjivtwhuvJ9jx1XOEaA=w544-h544-l90-rj"}]},"home2|Song mixes":{"title":"Song mixes","media_class":"directory","media_content_type":"home2","media_content_id":"Song mixes","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Flower In A Hurricane [From GTAVI: Original Score] (feat. King Gizzard & the Lizard Wizard) - Justice","media_class":"playlist","media_content_type":"track","media_content_id":"JWxoRY7AFSw","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/9U8oOKXg5Q9nsqScuWMyqITQc5VxtHkG8ZbVRWZgpjFuBEcmkn2AvohK-SQWRGuLr3Fa2esEIU79RgOK=w544-h544-l90-rj"},{"title":"Stop The Wedding! - Ashe","media_class":"playlist","media_content_type":"track","media_content_id":"BVR3k32x9h0","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/nA4rWHxnTBsANyHz94MeM-hvRV8WytkPCoQcbG7UhaI5c6pk01dfiOj9_54XWmIGj58mE9EiaSoKl1pT=w544-h544-l90-rj"},{"title":"Call Me - Kelsy Karter & The Heroines","media_class":"playlist","media_content_type":"track","media_content_id":"VdlCbji1CAg","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/J_TmXqoLb14jIX5jbOTfmgYl-qMWc8BbVrEoDE9AWDCI5zvjEX6lcV1IgUflTcerzD9SdG8D1budSOjv=w544-h544-l90-rj"},{"title":"Hootie Frutti - KATSEYE","media_class":"playlist","media_content_type":"track","media_content_id":"HY397w59MT4","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/LM6RBLp2-wM0ZMMyBwGu1HwXiPj3OuH87g-Ksmw_avEfoG3-sEn9oYUVfn89MDuQ7vROhAXBkFiBla4A=w544-h544-l90-rj"},{"title":"Blood In Your Eyes (from GTAVI: The Album) - Tove Lo","media_class":"playlist","media_content_type":"track","media_content_id":"0lI_KzhfIBk","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/dzVmIJQ9w5YJl0XT7KFMWFJI0II8at9axikiH6YacBJnJHNxRFi5IO5xBgJSq7bRDmIAFORK9HI0tMG7kw=w544-h544-l90-rj"},{"title":"Golden - HUNTR/X","media_class":"playlist","media_content_type":"track","media_content_id":"9_bTl2vvYQg","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/1U-1pXbvkpvGXGUIFs5m6RXz4Fmdvqo1zzQw8eY7b4G9iwpE6vaRclt8Ov5CS8ldROIQGu2InpGuSJSW=w544-h544-l90-rj"},{"title":"BbY WOW - KAROL G","media_class":"playlist","media_content_type":"track","media_content_id":"ljAH6jNaApU","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/GdW-pwzDkHLGvvf0pe_dgTcBYkJ2UFgsW6Zldnxyz-kX3l8I-QrRMow8IooEm7njIEAJauyWfoSV1rM=w544-h544-l90-rj"},{"title":"You’re Under Arrest - ILLIT","media_class":"playlist","media_content_type":"track","media_content_id":"qsqvJpOgrWw","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/EQNyUqxuYcONem8DYLwrXvMdc0rs-ryUcSgdgpxVkqtx53WRKr5YtBwEnaHBgnN5iWk90JBbdkrpSq4=w544-h544-l90-rj"},{"title":"COQUETA - Fuerza Regida","media_class":"playlist","media_content_type":"track","media_content_id":"fPczdTA1xU0","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/llYLq4jy6rSfhDDnEwL5rsxS80eBMvPzcZoryVzEQhbZCCOJMgcrkhtWiXTMLnASubnA0Ga99l6lVdUg=w544-h544-l90-rj"},{"title":"Don't Stop The Music - Bisken","media_class":"playlist","media_content_type":"track","media_content_id":"7WIWltd6CiM","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/qn1AKHBdT_xmKUxMmseOxhFlTVQ4zoDO60JyXcMRiy3DSvdT8HOCmty-wQyPD3F2BRN-1kKzrMWcZKjyjw=w544-h544-l90-rj"},{"title":"Love Options - BESTie","media_class":"playlist","media_content_type":"track","media_content_id":"jWwdHeJ8XeU","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/e_KhStFaUpXtdfyncHtYOBGibpgdw3fVixG8H0_E8aIW6G0Op9wo4jQqWsfHCEMaI96DnhsqlHM9Yzck=w544-h544-l90-rj"},{"title":"Sakuranbo - YENA","media_class":"playlist","media_content_type":"track","media_content_id":"6POlUfjBIB4","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/_RWfWayKDftrngXQ8sGahDtVVmqfhzji0cR1WTE2DWsW8VO7NJnDMStdjFYWj1lqoACBSxW8e5dnheHbIg=w544-h544-l90-rj"},{"title":"Hong Kong","media_class":"playlist","media_content_type":"track","media_content_id":"cUnEvW5aS80","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/X_xAPVJ2PYZCimHbT1dLd6JNQRNIzelWVSjUak_sBJXVUy2wajg7DHX__2B7O_fpi5iCKrOufTphwH3_=w544-h544-l90-rj"},{"title":"I Want You - ENHYPEN","media_class":"playlist","media_content_type":"track","media_content_id":"dBv5ju-TGZQ","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/p03tt4dCfQUZILU6EFkRanxOdpHXfKJi93xgjChLZkyUQS76s-ap-_QtjwHCtFy-QqdTdrdO4eNoaOMR=w544-h544-l90-rj"},{"title":"REDRED - CORTIS","media_class":"playlist","media_content_type":"track","media_content_id":"5sOgJQ3N03Q","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/QwlA1MsRGQRVG6kIPLEB068OXqVk4QKHWXeAIX0C-QaZ7Mzgh4f9JbXLj03itMK14uRL5EsnVmslkzN2=w544-h544-l90-rj"},{"title":"like JENNIE - JENNIE","media_class":"playlist","media_content_type":"track","media_content_id":"HMQlkbXjSTM","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/Z3gufPaLCcWuJNE4NH6KhlbUSrnx3hvUQgnhwQBrUDNzEgAp1aNMuCr0nv0gJxU8XcS2Rp9I-BHPZt_i=w544-h544-l90-rj"}]},"home2|Covers and remixes":{"title":"Covers and remixes","media_class":"directory","media_content_type":"home2","media_content_id":"Covers and remixes","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Save Your Tears ((Remix) Bonus Track) - The Weeknd","media_class":"playlist","media_content_type":"track","media_content_id":"lS9Kgp6PsWY","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/Ds4HZUl-Cziy9wW0zGv5_rRw0fGc01a3rMZ6mB27HkSTtVLaPwUpPaXdoISHAH3XprkYyPfIEcSpmPy-=w544-h544-l90-rj"},{"title":"Gimme Gimme Gimme (a man after midnight) - Syzz","media_class":"playlist","media_content_type":"track","media_content_id":"maY-KIK3EDI","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/dtBtgxv93fKsQPWiPJwgTiKu2bx3O0Zw8UFXt-PGE_xTSTblppXdovjJt6KigjLGhRC-E3C97t0CjDDvig=w544-h544-l90-rj"},{"title":"Remember Our Summer CYNIX Remix - CYNIX","media_class":"playlist","media_content_type":"track","media_content_id":"1x0e5svjyoA","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/1x0e5svjyoA/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCggAEOADGC0guwJIWg&rs=AMzJL3m6b1RsrcKkQCPkyDTNx2HXM7wmpA"},{"title":"Dracula (feat. JENNIE) - Tame Impala","media_class":"playlist","media_content_type":"track","media_content_id":"DXO288FnB-A","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/Oice7VFz5NBqKgPpD8LA0oIGkfNTc5N_2pRMifH_W4-aVjMDDBZ2-BafN55NEyXMqhD3ScUrrOxz7WgJ=w544-h544-l90-rj"},{"title":"Flo Rida feat. T-Pain - Low (FNZ Remix) - FNZ","media_class":"playlist","media_content_type":"track","media_content_id":"8s5o9JS9dsM","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/8s5o9JS9dsM/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCggAEOADGC0guwJIWg&rs=AMzJL3lhK_a8liz1kba7el0JWShA6hq2Eg"},{"title":"Stand by Me - Seal","media_class":"playlist","media_content_type":"track","media_content_id":"zRafBMo9t_A","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/V5xDQnI4LMH8syDXFHl4o8pRuzRdWYSHkSiTfW0FHJZwsHi_euzVRiGYQu_NASLFCyR1Lp9GmSVYYLbf=w544-h544-l90-rj"},{"title":"Die For You (Remix) - The Weeknd","media_class":"playlist","media_content_type":"track","media_content_id":"AySMGpXQ1Mo","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/liKrw5t_WphMbkiYKDHQj1rf8S8GSwxgMRUmB7tkHhPF862BRcqIYxFEj9QwKr51ge2ma6u0C_wI4jNo=w544-h544-l90-rj"},{"title":"Dracula (feat. JENNIE) - Tame Impala","media_class":"playlist","media_content_type":"track","media_content_id":"6KjVYeQ9SRw","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/FQsPsZdaGUkT3_Q-9iilsYnS6xc0CAerb6pIhUou-skal6-jMQQ-xUigopbvfqVP_e-msHiabmCN2wCl=w544-h544-l90-rj"},{"title":"Cold Heart (PNAU Remix) - Elton John","media_class":"playlist","media_content_type":"track","media_content_id":"e-S1k9-soT4","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/VMVJXxPN4zR2XFumd_ha6Siv27k2zFwViSm9kcXdUQdoABVYZcKgi-0F15dXkLMbL9bsN3zwCBrlsPVC=w544-h544-l90-rj"},{"title":"Love Me Like You Do - Elena Gray","media_class":"playlist","media_content_type":"track","media_content_id":"Q9HxtBBqmHA","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/Gl66E9Fq8mtYJ7AsrjpcuqSUD0xbUEktOJTqraY29-zDjn0ulyJoY8ymnYjvDRoZfN5LABtUAUzSPS-0=w544-h544-l90-rj"}]},"home2|Trending songs for you":{"title":"Trending songs for you","media_class":"directory","media_content_type":"home2","media_content_id":"Trending songs for you","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Go Easy (from GTAVI: The Album) - Dua Lipa","media_class":"playlist","media_content_type":"track","media_content_id":"eqQRPRcoIYo","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/93wEzW_3yAmPTCz4Ifov5EMT27W1_u1VRL0BpPtx14nAaDn1Cc_0xOZF6S0tJlXVymXLUy_mQZXPfLme5g=w544-h544-l90-rj"},{"title":"Beauty And A Beat - MOONLGHT","media_class":"playlist","media_content_type":"track","media_content_id":"LOvFNEryrOA","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/h3Bvv0VBQYxwPP2N4WG1Vwdn6-aIP4npIZnnB6K8OScpBQWorlasYRM0IK8-G5lgwpGKmExjgfrLNNzz=w544-h544-l90-rj"},{"title":"Devil Woman (GTA 6 Soundtrack) - Lena Vril","media_class":"playlist","media_content_type":"track","media_content_id":"zLilheGY7OY","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/KBhipyj9OUiFeulVBpV0jru8hSF15i36TFn78bg4HmuaECNjM7DeM2ihM-_jxMNQUZz7BeBNRjQcYhA=w544-h544-l90-rj"},{"title":"My Moon My Man - FINNEAS","media_class":"playlist","media_content_type":"track","media_content_id":"pQ_3P-0WwvU","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/bBZfYsRKPIu5esakP9qq5qVLu_unNsAn8zPYOwurEem14CLpHsKbUOme2Wnv6B9KYraeHW7GFMW9Zlg=w544-h544-l90-rj"},{"title":"Sexy Magic (from GTAVI: The Album) (feat. Grand Theft Auto VI) - CA7RIEL & Paco Amoroso","media_class":"playlist","media_content_type":"track","media_content_id":"VBKnzlBP95A","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/hbpSyosNXpw2uZ6_KOx0YjBLO-rMJx6gLxEE7Suz-sYnWYhoWu8FVk5FXJEDwJdncjWifi9UIbmDTJEU=w544-h544-l90-rj"},{"title":"Babydoll - Jamie Miller","media_class":"playlist","media_content_type":"track","media_content_id":"7MAs5b7EJyc","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/kJfU1ReE3SNAMamgEMmhwoLThQehu3c5wbRKP6X9koetAZEY-CoXFzfZPxMkdxkyGeKLrRi_z76KOruQ9g=w544-h544-l90-rj"},{"title":"Love - Keyshia Cole","media_class":"playlist","media_content_type":"track","media_content_id":"8M_-aaZUs4o","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/QiLklghd8Qj4HAVUHxpYDZ6MqLJ5rMP9SdH6LEZdSA-a38bepAhSBg3FVCAxIhFSNPs02xtmbE8Cn8aFfw=w544-h544-s-l90-rj"},{"title":"Innerbloom XI - RÜFÜS DU SOL","media_class":"playlist","media_content_type":"track","media_content_id":"MyeUOTWUNsE","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/Gk6GLgNgat-oez8Yl8tirJNj80jCNuN1HnnaoyhLPGazQP76XMGXzB67nL7KBJUz6wead6n8mH_jBFdk=w544-h544-l90-rj"},{"title":"Power Trip (from GTAVI: The Album) - JENNIE","media_class":"playlist","media_content_type":"track","media_content_id":"3uC4yshW6Yc","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/AwqUl_c3gIFWtvPf7h_tDz_gIlM8pLyTTxeVyIT14W1eoVCKfcmnrox73QDxI-YIntjKdKZGvh-c1twq=w544-h544-l90-rj"},{"title":"Leave With Me - LISA","media_class":"playlist","media_content_type":"track","media_content_id":"r58jywvd-Rw","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/EAgD2-ySGHKQdBxH3kj9IGjyJiXYP8Lkoa2dMvXb3KZUw1N_6ghCLiB9hklwRqZHqt8cVpnVviQ3r-Zo=w544-h544-l90-rj"},{"title":"Sun Showers (From \"The Angry Birds Movie 3”) - JISOO","media_class":"playlist","media_content_type":"track","media_content_id":"nfvXvCwqChY","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/M4Bx2xs5rppzER-NHQvimkZ29gyD9t99yKBBWvAk4PSTOcTKGyfUbKhdVeHuAQwbtrRAGGNNzCWwWGsv=w544-h544-l90-rj"},{"title":"ICONIC - CL","media_class":"playlist","media_content_type":"track","media_content_id":"6v-TZZKvADw","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/gDaFchnWU4AGuYCAPgHjkZ3oTkN_LU7IK9aYpkDED9zgZUUqxLgOjXE9W5338xoqLoIaTfunleAMnIxSQw=w544-h544-l90-rj"},{"title":"BABY ANGEL - NAYEON","media_class":"playlist","media_content_type":"track","media_content_id":"Z8ehh3ANZak","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/di75B_1bBuBn_TwuiQ_bMUNmHYLtVncpVY8KH5iVPvGRZ1jNMB20tIzhtuluWltcx4AF0YAaf1k3yZc=w544-h544-l90-rj"},{"title":"Tremendo Desastre - Myke Towers","media_class":"playlist","media_content_type":"track","media_content_id":"PWIQFC5YZPA","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/Nm_lkqCGk6JtexgRCc-XQsiYx_aWPexSC7KDP66iCA2v0cV-CmhwUTBkdxQ6sLEt0aYM2jEibDFDCdOeCw=w544-h544-l90-rj"},{"title":"Angel Bite - TOMORROW X TOGETHER","media_class":"playlist","media_content_type":"track","media_content_id":"5JkTq9rOYI8","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/JlSvnvfKfrsSqmYacyjKZUyGT5lDaON6lYGMobOoQSFMY6jZix3Uc6zCLUVdwt1oyDhXc3-4EGOeI6M=w544-h544-l90-rj"},{"title":"El Ojo Alegre - Lucero","media_class":"playlist","media_content_type":"track","media_content_id":"_ulXageeMis","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/sdnkjwUO2m4zxwGl3iG0ax205A0w6o584Rz125r7qxet41QMDdzK6LTuT6U9Oh943OGn1DIGhpzroed76A=w544-h544-l90-rj"}]},"home2|New releases":{"title":"New releases","media_class":"directory","media_content_type":"home2","media_content_id":"New releases","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"New Release Mix","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDTMAK5uy_lr0LWzGrq6FU9GIxWvFHTRPQD2LHMqlFA","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://music.youtube.com/image/mixart?r=ENgEGNgEMiAIBxoNL2cvMTF0ZzJ2a3IxehoNL2cvMTF2azhtMV81c2IICgYKBAoCZW4"},{"title":"Grand Theft Auto VI: The Album (Deluxe Edition)","media_class":"playlist","media_content_type":"album","media_content_id":"MPREb_TINpB57piQG","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/wSeM_CFdxBOWkA26uiVcmIGhsfwRtoU3QFaXRZm7i3BQnjm_H6HkQXhSX7QmF3oUjiWNOftVM86dBMKT=w544-h544-l90-rj"},{"title":"Live in Mexico City","media_class":"playlist","media_content_type":"album","media_content_id":"MPREb_eMs4ZDFJwXq","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/d6-E1VvQ1BQoNpKG2L3OVLNai9V7tnwu87doTmUNKdg5FC3Bh_NejaWpsS4Fjgt9kUhQ1GbP6chKSEppmw=w544-h544-l90-rj"},{"title":"Oh My Little Baby Boy","media_class":"playlist","media_content_type":"album","media_content_id":"MPREb_1VNQRlCRafA","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/0g39YYG1TCisyYWef7EzNyrPHHMQ5zHRpHT3jQvD0SP2Qzk9ireD0ynEi78_mGq9HWpu-BoeseOrE0hK=w544-h544-l90-rj"}]},"home2|All hits":{"title":"All hits","media_class":"directory","media_content_type":"home2","media_content_id":"All hits","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Gaming Hits","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_n9PTezEY6LrODsz6rl2KDtFzC9e5Qzz9Y","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/QrISu_Bk4sR6MN_TUD2bbWO4ZyfdSFJVE8JPpCD4P9uCRmyQtE1e3HjxtwsiomjiR0idTKD7Wl6w9A=w544-h544-l90-rj"},{"title":"Huge Dance Hits","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_kWiJXUNLZM9EyS3GBGznl1ku8_cOos97U","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/Lld802Wk-_qbAttIghD3-R2U9wjKT87qsY-9sUbxl1G4AQ4VKwA02HGg6QF56thp9HA-u6VCj76W=w544-h544-l90-rj"},{"title":"Pop Gold","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_nHSqCJjDrW9HBhCNdF6tWPdnOMngOv0wA","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/rAUuEbLF7CYEYBXU3yAY4npMCzTgPxMhlD-ygH9iv_SuDXGDuDvO0Z4MTh33xAI6o3UnpWFe26MS_hBZ=w544-h544-l90-rj"},{"title":"Hip-Hop Classics","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_kP2172rQNb3KFXz880xp6M98R_ME5CIKA","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/QbaOnF8DHmwx70wCX4E3e8QcmkZNaO91jkIqz1U-UcW_PFYzA2419D7icVlUZRrWwsDqxAal_RzCOg=w544-h544-l90-rj"},{"title":"Dance Hits","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_k6PkYWus1Mt-aKrbb0Ne8SkA2BgAk1Yy4","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/BJEqYDBiNwOS5x7siLvlpqISZOjTNTNmWBk5QzBF70y8RotdBrkHg24o5VFLxfrfheO8SFYyhUqAUJY=w544-h544-l90-rj"},{"title":"Hip-Hop Gaming Hits","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_nMRqcKbbYRujfKKitokBwvLQSFHnsomls","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/fhbtBeL6Pglzk0DfmwOTxX2cO7hkhFulB-uqDgKyEdoPQs6zcQFtm_eWFqltKv2W17LRNEkpZJBNpw=w544-h544-l90-rj"},{"title":"Pop's Biggest Hits","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_nmS3YoxSwVVQk9lEQJ0UX4ZCjXsW_psU8","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/ih5QdpqpkVNRXtD-joBWj3jo1woxAXJFyAoA3hWYNWAKX0M9B825HH2VOh7aDX-unf67oyCyJGN9TljR=w544-h544-l90-rj"},{"title":"Drum & Bass Room","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_lwP-V7kSIhX3CJEV7zRd9P8Nj0F1l5RbY","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/Qcd9QnCfMmsjdl8mXNlxHf9N0csfuOr3Gb_2aH7WCcr1RbIRXRvpnoiyTeKlL54d3PT9s0YbQznsAxU=w544-h544-l90-rj"},{"title":"Heavy Hitters","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_nVT2-bFfxplES7OQSLcnwlJqpsQ9gn0yY","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/p2FmWBFqHEbEc8S-T-19oIt0saD5sc2r7lwtgxxaKNulklqdmWUVtOShVLA6X-0-bVCjOlNr3jzixQ=w544-h544-l90-rj"}]},"home2|Today's biggest hits":{"title":"Today's biggest hits","media_class":"directory","media_content_type":"home2","media_content_id":"Today's biggest hits","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Pop Certified","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_lBNUteBRencHzKelu5iDHwLF6mYqjL-JU","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/BchO1e_VlImwqaOcFKhjEmQj9x_gfumqInfztMvIlbSoxfpFeyu3uJoMkIDtx22Hng_PCtg2XmWm_g=w544-h544-l90-rj"},{"title":"Chroma: Today's Dance Hits","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_kLWIr9gv1XLlPbaDS965-Db4TrBoUTxQ8","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/bgyYaDg4vQmS4TB1A5vZbnTO0X3Dp2K466u7ZJcEKB7fY4o8Mg3BAObHle4ZMGhEVBWGJ17YMoYqgQ=w544-h544-l90-rj"},{"title":"Hits Remixed","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_l2zLaMIWOqWSePvTSmt49GcuR8460ZR10","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/8QAvBU7EabmeoXp8wtBoFPROpZy0LVDU5CqrMmKy6ubrwixctxAJdWs7u9ZkZIx1dbB37hAnx6tHXRgh=w544-h544-l90-rj"},{"title":"EDM 2026","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_mOGSCVBsZurORfvybL5lEwxKsNFlZ8cPY","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/DJhVFzpwJJBcnOQpHEjnZgqon_9TFlQNiss38auB9zqNItAv9ivXZmbaWNiXErYhEE1MVvq51c-3zw=w544-h544-l90-rj"},{"title":"Hits Unplugged ","media_class":"playlist","media_content_type":"playlist","media_content_id":"RDCLAK5uy_mdwsZFtQhJyGQPuQA612VoRPXp-OJfzx8","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/t4ITg7S7zqTh93EXNlRoPSaAXIR7nQrdpo3BlGtJ3lkaqsRz5Pu-nWHXjcd7hMlzCirM6-HZ00PvrCKc=w544-h544-l90-rj"}]},"home2|Music videos for you":{"title":"Music videos for you","media_class":"directory","media_content_type":"home2","media_content_id":"Music videos for you","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"I Don't Want To Talk About It (Live) - Rod Stewart","media_class":"playlist","media_content_type":"track","media_content_id":"w46bWxS9IjY","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/w46bWxS9IjY/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3kPxizLkdJBFIu9K4f7uo7NjTP2KQ"},{"title":"I Knew It, I Knew You/ Our Song (Live) - Taylor Swift","media_class":"playlist","media_content_type":"track","media_content_id":"LJC7mgjp5FQ","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/LJC7mgjp5FQ/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3mM4YESRNfhv97MCbjSE09Hpz_s2A"},{"title":"Training Season (Live) - Dua Lipa","media_class":"playlist","media_content_type":"track","media_content_id":"3DcoC8p9az8","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/3DcoC8p9az8/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3nXjjpO-FKPYZlsQJctsBsCEeZFSA"},{"title":"Dusk Till Dawn (feat. Sia) - ZAYN","media_class":"playlist","media_content_type":"track","media_content_id":"tt2k8PGm-TI","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/tt2k8PGm-TI/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3mwQETV3eMp1l7fpqqCQirCg9x7PA"},{"title":"ADDICTED - JISOO","media_class":"playlist","media_content_type":"track","media_content_id":"Pksr9T8m_aA","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/Pksr9T8m_aA/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3nthnoizeIpaXcWtt98-BPcJ6ZSXg"},{"title":"TQG - KAROL G","media_class":"playlist","media_content_type":"track","media_content_id":"jZGpkLElSu8","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/jZGpkLElSu8/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3mcWVQ9jm77acjGdDNvQ8VeKgaDRw"},{"title":"It's Me - ILLIT","media_class":"playlist","media_content_type":"track","media_content_id":"bMhDJ0S0OBA","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/bMhDJ0S0OBA/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3lRd-ngPHNZ1KbFt6pba5wdAVIEwQ"},{"title":"HOLLYWOOD - Peso Pluma","media_class":"playlist","media_content_type":"track","media_content_id":"rCL8-CiGSmc","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/rCL8-CiGSmc/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3mOpJu1dMkOEnAVOczmJsUo7D2lpg"}]},"home2|Featured playlists for you":{"title":"Featured playlists for you","media_class":"directory","media_content_type":"home2","media_content_id":"Featured playlists for you","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Top 100 Music Videos Global","media_class":"playlist","media_content_type":"playlist","media_content_id":"PL4fGSI1pDJn5kI81J1fYWK5eZRl1zJ5kM","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/9FVtwu1BWibyR39Mv1wIGDkpQXTuhAcHMM1D3RQLEDOeMDz9jtRFG_GnliUGMXXP8HoJJ1w0og=s544"},{"title":"Daily Top Music Videos - Global","media_class":"playlist","media_content_type":"playlist","media_content_id":"PL4fGSI1pDJn6t3TXLGiiJdD-sZbrG3tG0","children_media_class":null,"can_play":true,"can_expand":true,"thumbnail":"https://yt3.googleusercontent.com/zXfgdEQFwlHIbhe_h5F7LQly0XtWbbk-k3hoffmDNOyfNiZx6XAOEzYW7ojOG-LlGi9w9qyfJ8cw=s544"}]},"home2|Live performances":{"title":"Live performances","media_class":"directory","media_content_type":"home2","media_content_id":"Live performances","children_media_class":"playlist","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Let Me Love You - Mario","media_class":"playlist","media_content_type":"track","media_content_id":"D6vCMxmkMKI","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/ld8MgzxD57OHR1UWFbqPHQ1tFMu7KeiWz89gMxhqlH3Vmk6pGsKTR1T8JKtur1P8jj6oq1aa-knevkY=w544-h544-l90-rj"},{"title":"Training Season (Live from the Royal Albert Hall) - Dua Lipa","media_class":"playlist","media_content_type":"track","media_content_id":"2tw2QDSeBQQ","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/mRy_-GXuXaHpjkGh4pyMTDh9nw5Yzr-5EcvOgmfUA8xVCVQ0Ewdx_Xt1kzc1GvXNxHrUxmbHXh1xH1HC=w544-h544-l90-rj"},{"title":"Lost On You (Live) - LP","media_class":"playlist","media_content_type":"track","media_content_id":"wDjeBNv6ip0","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://i.ytimg.com/vi/wDjeBNv6ip0/hq720.jpg?sqp=-oaymwEKCKAGEMIDIABIWg&rs=AMzJL3kHFkLOnqkOC1EQ9Y-WFg63tYlYGQ"},{"title":"El Perdedor - Aventura","media_class":"playlist","media_content_type":"track","media_content_id":"EJuxDbSkwmQ","children_media_class":null,"can_play":true,"can_expand":false,"thumbnail":"https://yt3.googleusercontent.com/AKOi8e955qeoo82rZTlkDwCYgNZP6e02k5Cr1BRvzcAHMOYbQ7w1f1GrK2eVqjivtwhuvJ9jx1XOEaA=w544-h544-l90-rj"}]},"root":{"title":"Media Library","media_class":"directory","media_content_type":"library","media_content_id":"library","children_media_class":"directory","can_play":false,"can_expand":true,"thumbnail":null,"children":[{"title":"Home","media_class":"playlist","media_content_type":"home","media_content_id":"","children_media_class":null,"can_play":false,"can_expand":true,"thumbnail":null}]}}; // i18n-ok: song and album names as YouTube Music gives them

/** Songs the speakers go through (next, previous) – each with its cover. */
export const TRACKS: { title: string; artist: string; picture: string }[] = [{"title":"Flower In A Hurricane [From GTAVI: Original Score] (feat. King Gizzard & the Lizard Wizard)","artist":"Justice","picture":"https://yt3.googleusercontent.com/9U8oOKXg5Q9nsqScuWMyqITQc5VxtHkG8ZbVRWZgpjFuBEcmkn2AvohK-SQWRGuLr3Fa2esEIU79RgOK=w544-h544-l90-rj"},{"title":"Gimme Gimme Gimme (a man after midnight)","artist":"Syzz","picture":"https://yt3.googleusercontent.com/dtBtgxv93fKsQPWiPJwgTiKu2bx3O0Zw8UFXt-PGE_xTSTblppXdovjJt6KigjLGhRC-E3C97t0CjDDvig=w544-h544-l90-rj"},{"title":"Dracula (feat. JENNIE)","artist":"Tame Impala","picture":"https://yt3.googleusercontent.com/Oice7VFz5NBqKgPpD8LA0oIGkfNTc5N_2pRMifH_W4-aVjMDDBZ2-BafN55NEyXMqhD3ScUrrOxz7WgJ=w544-h544-l90-rj"},{"title":"Stop The Wedding!","artist":"Ashe","picture":"https://yt3.googleusercontent.com/nA4rWHxnTBsANyHz94MeM-hvRV8WytkPCoQcbG7UhaI5c6pk01dfiOj9_54XWmIGj58mE9EiaSoKl1pT=w544-h544-l90-rj"},{"title":"Call Me","artist":"Kelsy Karter & The Heroines","picture":"https://yt3.googleusercontent.com/J_TmXqoLb14jIX5jbOTfmgYl-qMWc8BbVrEoDE9AWDCI5zvjEX6lcV1IgUflTcerzD9SdG8D1budSOjv=w544-h544-l90-rj"},{"title":"Hootie Frutti","artist":"KATSEYE","picture":"https://yt3.googleusercontent.com/LM6RBLp2-wM0ZMMyBwGu1HwXiPj3OuH87g-Ksmw_avEfoG3-sEn9oYUVfn89MDuQ7vROhAXBkFiBla4A=w544-h544-l90-rj"},{"title":"Blood In Your Eyes (from GTAVI: The Album)","artist":"Tove Lo","picture":"https://yt3.googleusercontent.com/dzVmIJQ9w5YJl0XT7KFMWFJI0II8at9axikiH6YacBJnJHNxRFi5IO5xBgJSq7bRDmIAFORK9HI0tMG7kw=w544-h544-l90-rj"},{"title":"Golden","artist":"HUNTR/X","picture":"https://yt3.googleusercontent.com/1U-1pXbvkpvGXGUIFs5m6RXz4Fmdvqo1zzQw8eY7b4G9iwpE6vaRclt8Ov5CS8ldROIQGu2InpGuSJSW=w544-h544-l90-rj"},{"title":"Stand by Me","artist":"Seal","picture":"https://yt3.googleusercontent.com/V5xDQnI4LMH8syDXFHl4o8pRuzRdWYSHkSiTfW0FHJZwsHi_euzVRiGYQu_NASLFCyR1Lp9GmSVYYLbf=w544-h544-l90-rj"},{"title":"Love Me Like You Do","artist":"Elena Gray","picture":"https://yt3.googleusercontent.com/Gl66E9Fq8mtYJ7AsrjpcuqSUD0xbUEktOJTqraY29-zDjn0ulyJoY8ymnYjvDRoZfN5LABtUAUzSPS-0=w544-h544-l90-rj"},{"title":"Go Easy (from GTAVI: The Album)","artist":"Dua Lipa","picture":"https://yt3.googleusercontent.com/93wEzW_3yAmPTCz4Ifov5EMT27W1_u1VRL0BpPtx14nAaDn1Cc_0xOZF6S0tJlXVymXLUy_mQZXPfLme5g=w544-h544-l90-rj"},{"title":"Beauty And A Beat","artist":"MOONLGHT","picture":"https://yt3.googleusercontent.com/h3Bvv0VBQYxwPP2N4WG1Vwdn6-aIP4npIZnnB6K8OScpBQWorlasYRM0IK8-G5lgwpGKmExjgfrLNNzz=w544-h544-l90-rj"},{"title":"Devil Woman (GTA 6 Soundtrack)","artist":"Lena Vril","picture":"https://yt3.googleusercontent.com/KBhipyj9OUiFeulVBpV0jru8hSF15i36TFn78bg4HmuaECNjM7DeM2ihM-_jxMNQUZz7BeBNRjQcYhA=w544-h544-l90-rj"},{"title":"My Moon My Man","artist":"FINNEAS","picture":"https://yt3.googleusercontent.com/bBZfYsRKPIu5esakP9qq5qVLu_unNsAn8zPYOwurEem14CLpHsKbUOme2Wnv6B9KYraeHW7GFMW9Zlg=w544-h544-l90-rj"},{"title":"Babydoll","artist":"Jamie Miller","picture":"https://yt3.googleusercontent.com/kJfU1ReE3SNAMamgEMmhwoLThQehu3c5wbRKP6X9koetAZEY-CoXFzfZPxMkdxkyGeKLrRi_z76KOruQ9g=w544-h544-l90-rj"},{"title":"Love","artist":"Keyshia Cole","picture":"https://yt3.googleusercontent.com/QiLklghd8Qj4HAVUHxpYDZ6MqLJ5rMP9SdH6LEZdSA-a38bepAhSBg3FVCAxIhFSNPs02xtmbE8Cn8aFfw=w544-h544-s-l90-rj"}]; // i18n-ok: song and album names as YouTube Music gives them

export const MEDIA_SOURCE = "media_player.youtube_music";
export const SPEAKERS = ["media_player.kitchen_speaker", "media_player.office_speaker", "media_player.living_room_speaker", "media_player.bathroom_speaker"];
// what a speaker of the demo does: play, pause, seek, volume, next, shuffle, repeat, grouping
const SPEAKER = 842303;
// YouTube Music: the same without grouping, and a library to browse
const SOURCE = 449471;

const song = (i: number, at = 0, dur = 214): Attrs => {
  const t = TRACKS[i % TRACKS.length];
  return {
    media_title: t.title,
    media_artist: t.artist,
    entity_picture: t.picture,
    media_content_type: "music",
    media_duration: dur,
    media_position: at,
    media_position_updated_at: new Date().toISOString(),
    track: i % TRACKS.length,
  };
};

const PAIR = ["media_player.kitchen_speaker", "media_player.office_speaker"];
// the living room's soundbar plays the TV's sound: YouTube on the Apple TV (the card's tv_sources)
const VIDEO = {
  media_title: "synthwave radio 🌌 beats to chill/game to",
  media_content_type: "video",
  media_duration: 3600,
  media_position: 1312,
  media_position_updated_at: new Date().toISOString(),
};
export const MEDIA_STATES: Record<string, DemoState> = {
  "media_player.living_room_speaker": [
    "playing",
    {
      friendly_name: "Living room",
      device_class: "speaker",
      supported_features: SPEAKER,
      volume_level: 0.34,
      is_volume_muted: false,
      group_members: ["media_player.living_room_speaker"],
      source: "TV",
      media_title: "TV Audio",
      media_content_type: "music",
    },
  ],
  "media_player.living_room_tv": ["on", { friendly_name: "Living room TV", device_class: "tv", source: "Apple TV", source_list: ["Apple TV", "PS5", "Netflix", "YouTube"] }],
  "media_player.living_room_apple_tv": ["playing", { friendly_name: "Apple TV", supported_features: 21437, app_id: "com.google.ios.youtube", app_name: "YouTube", ...VIDEO }],
  "media_player.living_room_youtube": [
    "playing",
    { friendly_name: "YouTube on TV", supported_features: 21437, media_artist: "Lofi Girl", entity_picture: "https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg", ...VIDEO },
  ],
  "media_player.kitchen_speaker": [
    "playing",
    { friendly_name: "Kitchen", device_class: "speaker", supported_features: SPEAKER, volume_level: 0.22, is_volume_muted: false, shuffle: false, repeat: "all", group_members: PAIR, ...song(0, 74) },
  ],
  "media_player.office_speaker": [
    "playing",
    { friendly_name: "Office", device_class: "speaker", supported_features: SPEAKER, volume_level: 0.26, is_volume_muted: false, shuffle: false, repeat: "all", group_members: PAIR, ...song(0, 74) },
  ],
  "media_player.bathroom_speaker": [
    "idle",
    { friendly_name: "Bathroom", device_class: "speaker", supported_features: SPEAKER, volume_level: 0.18, is_volume_muted: false, shuffle: false, repeat: "off", group_members: ["media_player.bathroom_speaker"] },
  ],
  "media_player.youtube_music": ["idle", { friendly_name: "YouTube Music", supported_features: SOURCE, shuffle: true, repeat: "all", remote_player_id: "media_player.kitchen_speaker" }],
};

/** browse_media of the demo's YouTube Music: the snapshot, folder by folder. */
export function browseDemoMedia(msg: Record<string, unknown>): Attrs | undefined {
  if (msg.entity_id !== MEDIA_SOURCE) return undefined;
  const key = msg.media_content_type === undefined ? "root" : `${msg.media_content_type}|${msg.media_content_id ?? ""}`;
  const node = YTM_LIBRARY[key];
  if (node) return structuredClone(node);
  // a playlist / album of the demo: songs from the library's song mixes ("Song - Artist"), as its tracks
  if (msg.media_content_type !== undefined && /playlist|album/i.test(String(msg.media_content_type))) {
    const songs = Object.values(YTM_LIBRARY)
      .flatMap((n) => n.children ?? [])
      .filter((c) => !c.can_expand && / - /.test(String(c.title)));
    const seed = [...String(msg.media_content_id ?? "")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7);
    const pick = songs.length ? Array.from({ length: Math.min(14, songs.length) }, (_, i) => songs[(seed + i * 7) % songs.length]) : [];
    return {
      title: String(msg.media_content_id ?? ""),
      media_class: "playlist",
      media_content_type: msg.media_content_type,
      media_content_id: msg.media_content_id ?? "",
      can_play: true,
      can_expand: true,
      children: pick.map((c) => ({ ...c, media_class: "track" })),
    };
  }
  return { title: String(msg.media_content_id ?? "YouTube Music"), media_class: "directory", media_content_type: msg.media_content_type, media_content_id: msg.media_content_id ?? "", can_play: false, can_expand: true, children: [] };
}

/** An item of the library by its id (what play_media was told to play). */
function findItem(id: string): Attrs | undefined {
  for (const node of Object.values(YTM_LIBRARY)) for (const c of node.children ?? []) if (c.media_content_id === id) return c;
  return undefined;
}

/** The playing media of a player (copied to a speaker joining it). */
function playing(a: Attrs): Attrs {
  const keys = ["media_title", "media_artist", "entity_picture", "media_duration", "media_position", "media_position_updated_at", "track", "shuffle", "repeat"];
  return Object.fromEntries(keys.filter((k) => k in a).map((k) => [k, a[k]]));
}

type Get = (id: string) => { state: string; attributes: Attrs } | undefined;
type Put = (id: string, s: DemoState) => void;

/**
 * What a media service does to the demo's players. Returns false when none of them is meant
 * (the caller does its usual thing).
 */
export function demoMediaService(service: string, list: string[], d: Attrs, get: Get, put: Put): boolean {
  const mine = list.filter((id) => id in MEDIA_STATES);
  if (!mine.length) return false;
  // a group plays as one: what the leader does, its members do
  const group = (id: string) => {
    const m = (get(id)?.attributes.group_members as string[] | undefined) ?? [id];
    return m.length > 1 ? m : [id];
  };
  // YouTube Music acts on the speaker it plays on (and its group)
  const through = (id: string, a: Attrs) => (id === MEDIA_SOURCE && a.remote_player_id ? [id, ...group(String(a.remote_player_id))] : group(id));
  const now = () => new Date().toISOString();
  for (const id of mine) {
    const s = get(id);
    if (!s) continue;
    const a = s.attributes;
    switch (service) {
      case "media_play":
      case "media_pause":
      case "media_stop":
      case "media_play_pause": {
        const play = service === "media_play" || (service === "media_play_pause" && s.state !== "playing");
        // the position stops where it was, and goes on from there
        const ran = s.state === "playing" && a.media_position_updated_at ? (Date.now() - Date.parse(a.media_position_updated_at)) / 1000 : 0;
        const at = Math.min(Number(a.media_position ?? 0) + ran, Number(a.media_duration ?? 1e9));
        for (const g of through(id, a)) put(g, [play ? "playing" : "paused", { media_position: at, media_position_updated_at: now() }]);
        break;
      }
      case "media_next_track":
      case "media_previous_track": {
        const i = Number(a.track ?? 0) + (service === "media_next_track" ? 1 : TRACKS.length - 1);
        for (const g of through(id, a)) put(g, ["playing", song(i)]);
        break;
      }
      case "media_seek":
        for (const g of through(id, a)) put(g, [get(g)!.state, { media_position: Number(d.seek_position ?? 0), media_position_updated_at: now() }]);
        break;
      case "volume_set":
        put(id, [s.state, { volume_level: Number(d.volume_level ?? a.volume_level), is_volume_muted: false }]);
        break;
      case "volume_mute":
        put(id, [s.state, { is_volume_muted: !!d.is_volume_muted }]);
        break;
      case "shuffle_set":
        for (const g of through(id, a)) put(g, [get(g)!.state, { shuffle: !!d.shuffle }]);
        break;
      case "repeat_set":
        for (const g of through(id, a)) put(g, [get(g)!.state, { repeat: String(d.repeat ?? "off") }]);
        break;
      case "turn_on":
        if (s.state === "off") put(id, ["idle", {}]);
        break;
      case "turn_off":
        put(id, ["off", {}]);
        break;
      case "select_source":
        // YouTube Music told which speaker to play on
        if (id === MEDIA_SOURCE && typeof d.source === "string" && d.source in MEDIA_STATES) put(id, [s.state, { remote_player_id: d.source }]);
        break;
      case "join": {
        const add = ((Array.isArray(d.group_members) ? d.group_members : [d.group_members]) as string[]).filter((x) => x in MEDIA_STATES);
        const members = [...new Set([...group(id), ...add])];
        for (const g of members) put(g, [g === id ? s.state : s.state, { group_members: members, ...(g === id ? {} : playing(a)) }]);
        break;
      }
      case "unjoin": {
        const rest = group(id).filter((x) => x !== id);
        for (const g of rest) put(g, [get(g)!.state, { group_members: rest.length > 1 ? rest : [g] }]);
        put(id, ["idle", { group_members: [id], media_title: null, media_artist: null, entity_picture: null, media_duration: null, media_position: null }]);
        break;
      }
      case "play_media": {
        // what was tapped plays – on YouTube Music's speaker when it's YouTube Music
        const item = findItem(String(d.media_content_id ?? ""));
        const on = id === MEDIA_SOURCE ? String(a.remote_player_id ?? SPEAKERS[0]) : id;
        const name = String(item?.title ?? "Music");
        const cut = name.lastIndexOf(" - ");
        const meta = {
          ...song(Number(a.track ?? 0) + 1),
          media_title: cut > 0 ? name.slice(0, cut) : name,
          media_artist: cut > 0 ? name.slice(cut + 3) : "YouTube Music",
          ...(item?.thumbnail ? { entity_picture: item.thumbnail } : {}),
        };
        for (const g of group(on)) put(g, ["playing", meta]);
        if (id === MEDIA_SOURCE) put(id, ["playing", { ...meta, remote_player_id: on }]);
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/**
 * The demo's Music Assistant (its address and token in the demo's cards): its home's rows – as
 * Music Assistant with YouTube Music in it gives them – and a playlist's tracks. Answered in the
 * page, no server behind it.
 */
const libItems = (row: string) => (YTM_LIBRARY[`home2|${row}`]?.children ?? []) as Attrs[];
const maImg = (path?: string) => (path ? { path, type: "thumb", provider: "ytmusic", remotely_accessible: true } : undefined);
const maTrack = (t: { title: string; artist: string; picture: string }, i: number) => ({
  item_id: `t${i}`,
  provider: "ytmusic",
  media_type: "track",
  uri: `ytmusic://track/demo${i}`,
  name: t.title,
  artists: [{ name: t.artist }],
  image: maImg(t.picture),
});
const maList = (row: string, type: "playlist" | "album") =>
  libItems(row)
    .filter((c) => c.thumbnail)
    .map((c, i) => ({ item_id: `${row}-${i}`, provider: "ytmusic", media_type: type, uri: String(c.media_content_id), name: String(c.title), owner: "YouTube Music", image: maImg(String(c.thumbnail)) }));

/** Played lately: the best known first. */
const LEAD = ["Dua Lipa", "Tame Impala", "Seal", "FINNEAS", "Tove Lo", "Ashe"];
const lately = () => [...TRACKS].sort((a, b) => ((LEAD.indexOf(a.artist) + 99) % 99) - ((LEAD.indexOf(b.artist) + 99) % 99) || 0);

export function demoMaCommand(command: string): unknown {
  switch (command) {
    case "music/recommendations":
      return [
        { item_id: "listen", provider: "ytmusic", name: "Listen again", items: lately().map(maTrack) },
        { item_id: "mixed", provider: "ytmusic", name: "Mixed for you", items: [...maList("Today's biggest hits", "playlist"), ...maList("All hits", "playlist")].filter((p) => !/Gaming/.test(p.name)) },
        { item_id: "albums", provider: "ytmusic", name: "Albums for you", items: maList("New releases", "album") },
        { item_id: "recent", provider: "library", name: "Recently played", items: [...TRACKS].reverse().map(maTrack) },
      ];
    case "music/playlists/playlist_tracks":
    case "music/albums/album_tracks":
      return TRACKS.map(maTrack);
    default:
      return [];
  }
}
