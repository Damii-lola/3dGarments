# Synthetic flat-lay tee photos for testing the scanner (web/src/scan). Plumbing tests only - not real-photo quality.
# usage: mkdir -p out/photos && python3 tools/scan/make_test_photos.py   (needs pillow, numpy)
import numpy as np, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont
rng=np.random.RandomState(7)

def tee_polygon(boxy=False, scoop=95):
    # coordinates in a 1000x1100 design space, flat-lay tee seen from the front
    if not boxy:
        pts=[(230,190),(55,430),(140,525),(265,445),(268,1010),(732,1010),(735,445),(860,525),(945,430),(770,190)]
        nl,nr=(408,118),(592,118)
    else:   # wider, shorter, dropped shoulders
        pts=[(190,215),(30,470),(125,580),(215,490),(190,1000),(810,1000),(785,490),(875,580),(970,470),(810,215)]
        nl,nr=(395,125),(605,125)
    return pts,nl,nr,scoop

def render(name, base=(196,48,52), stripes=None, print_kind=None, boxy=False, back=False, bg=(228,226,222)):
    W,H=1200,1300; SS=2
    im=Image.new('RGB',(W*SS,H*SS),bg)
    # background gradient + noise
    g=np.linspace(0.93,1.04,H*SS)[:,None,None]; arr=np.array(im).astype(float)*g
    arr+=rng.normal(0,2.2,arr.shape); im=Image.fromarray(np.clip(arr,0,255).astype(np.uint8))
    pts,nl,nr,scoop=tee_polygon(boxy)
    sx,sy,ox,oy=1.0*SS,1.0*SS,100*SS,80*SS
    T=lambda p:(p[0]*sx+ox,p[1]*sy+oy)
    # outline with neck scoop
    neck=[]
    for k in range(0,21):
        t=k/20; x=nl[0]+(nr[0]-nl[0])*t; depth=scoop if not back else 25
        y=nl[1]+ (depth*4*t*(1-t))*1.0 + (0 if not back else 0)
        neck.append((x,y))
    outline=[nl]+list(reversed(pts[:5]))[::-1][:0]  # placeholder (kept simple below)
    poly=[pts[0]]+pts[1:5]+pts[5:]  # left shoulder .. right shoulder
    full=[nl]+poly+[nr]+list(reversed(neck))
    mask=Image.new('L',im.size,0); ImageDraw.Draw(mask).polygon([T(p) for p in full],fill=255)
    # soft shadow
    sh=mask.filter(ImageFilter.GaussianBlur(14*SS)); sh=sh.point(lambda v:int(v*0.28))
    shadow=Image.new('RGB',im.size,(60,58,55)); shifted=Image.new('L',im.size,0); shifted.paste(sh,(10*SS,16*SS)); im.paste(shadow,(0,0),shifted)
    # fabric
    fab=np.zeros((H*SS,W*SS,3),float); fab[:]=base
    yy,xx=np.mgrid[0:H*SS,0:W*SS]
    if stripes:
        c2,period=stripes; band=((yy-oy)//(period*SS))%2==0
        fab[band]=c2
    # print
    fabim=Image.fromarray(np.clip(fab,0,255).astype(np.uint8)); d=ImageDraw.Draw(fabim)
    try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',int(120*SS))
    except: font=ImageFont.load_default()
    cx=(500)*sx+ox
    if print_kind=='logo' and not back:
        r=95*SS; cy=(330)*sy+oy; d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=(250,250,250)); d.ellipse([cx-r*0.62,cy-r*0.62,cx+r*0.62,cy+r*0.62],fill=base)
        d.text((cx,cy+r+60*SS),'SCAN',fill=(250,250,250),font=font,anchor='mm')
    if print_kind=='logo' and back:
        d.text((cx,(520)*sy+oy),'BACK',fill=(250,250,250),font=font,anchor='mm'); d.rectangle([cx-260*SS,(640)*sy+oy,cx+260*SS,(670)*sy+oy],fill=(250,250,250))
    if print_kind=='pocket':
        x0,y0=(620)*sx+ox,(300)*sy+oy; d.rectangle([x0,y0,x0+120*SS,y0+130*SS],outline=(30,30,30),width=5*SS)
    fab=np.array(fabim).astype(float)
    # shading: vertical folds + vignette + noise
    fab*= (1+0.05*np.sin((xx-ox)/(38*SS)))[...,None]*(0.93+0.12*np.clip((yy-oy)/(900*SS),0,1))[...,None]
    fab+=rng.normal(0,3.0,fab.shape)
    fabim=Image.fromarray(np.clip(fab,0,255).astype(np.uint8))
    im.paste(fabim,(0,0),mask)
    # collar rib: darker band along the neckline
    d2=ImageDraw.Draw(im)
    d2.line([T(p) for p in neck],fill=tuple(int(c*0.7) for c in base) if not stripes else (30,30,60),width=int(26*SS))
    # inside-back of the collar visible through the scoop
    if not back:
        inner=[(x,y-20) for x,y in neck]; d2.polygon([T(nl)]+[T(p) for p in neck]+[T(nr)],fill=bg)
        d2.line([T(p) for p in neck],fill=tuple(int(c*0.7) for c in base) if not stripes else (30,30,60),width=int(26*SS))
    im=im.resize((W,H),Image.LANCZOS)
    im.save(f'out/photos/{name}.jpg',quality=92)
render('red_logo_front',print_kind='logo')
render('red_logo_back',print_kind='logo',back=True)
render('navy_stripes_front',base=(30,42,86),stripes=((236,236,236),70))
render('green_boxy_pocket',base=(58,122,84),print_kind='pocket',boxy=True)
render('white_plain',base=(238,238,234),bg=(205,208,214))
print('ok')
