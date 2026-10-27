#!/bin/bash
# usage: tex.sh name "weights" contrast "lut_r" "lut_g" "lut_b" [linen]
FF=/opt/homebrew/bin/ffmpeg
name=$1; weights=$2; con=$3; lr=$4; lg=$5; lb=$6; linen=$7
oct() { echo "color=gray:s=$1,format=gray,noise=alls=$2:allf=u,format=gray,scale=3200:2000:flags=bicubic"; }
if [ -n "$linen" ]; then
  fc="$(oct 48x30 70)[a];$(oct 200x125 70)[b];$(oct 3200x260 60)[c];$(oct 400x2000 60)[d];$(oct 3200x2000 80)[e];"
else
  fc="$(oct 32x20 80)[a];$(oct 120x75 80)[b];$(oct 480x300 80)[c];$(oct 1600x1000 80)[d];$(oct 3200x2000 80)[e];"
fi
fc+="[a][b][c][d][e]mix=inputs=5:weights='$weights',format=gray,eq=contrast=$con,format=rgb24,lutrgb=r='$lr':g='$lg':b='$lb',format=yuvj420p"
$FF -v error -y -filter_complex "$fc" -frames:v 1 -q:v 2 "$name.jpg" && $FF -v error -y -i "$name.jpg" -vf "crop=1600:1000:800:500,scale=800:-1" "crop-$name.jpg" && $FF -v error -y -i "$name.jpg" -vf scale=800:-1 "thumb-$name.jpg"
