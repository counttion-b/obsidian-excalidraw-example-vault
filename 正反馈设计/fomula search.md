# 高中物理：圆周运动公式整理

## 一、描述圆周运动的基本物理量

### 1. 周期、频率、转速


$T=\dfrac{1}{f}$

转速 $n$ 与频率关系：

$n=\frac{1}{T}$


---

## 二、线速度与角速度

### 1. 线速度

线速度大小：

$v=\dfrac{s}{t}$

匀速圆周运动中：

$v=\dfrac{2\pi r}{T}$


---

### 2. 角速度

角速度定义：

$\omega=\dfrac{\theta}{t}$

匀速圆周运动中：

$\omega=\dfrac{2\pi}{T}$

也可以写成：

$\omega=2\pi f$

---

### 3. 线速度与角速度关系

$v=\omega r$

---

## 三、向心加速度

### 1. 向心加速度基本公式

$a_n=\dfrac{v^2}{r}$

$a_n=\omega^2 r$

$a_n=v\omega$

---

### 2. 用周期、频率表示

$a_n=\dfrac{4\pi^2 r}{T^2}$

---

## 四、向心力

### 1. 向心力基本公式

$F_n=m\dfrac{v^2}{r}$

$F_n=m\omega^2 r$

$F_n=mv\omega$

---

### 2. 用周期、频率表示

$F_n=m\dfrac{4\pi^2 r}{T^2}$

---

### 3. 向心力来源

向心力不是一种新的力，而是物体受到的**合力沿半径指向圆心的分力**。

因此解题时常用：

$F_{\text{合，径向}}=m\dfrac{v^2}{r}$

或：

$F_{\text{合，径向}}=m\omega^2r$

---

## 五、同轴转动与皮带传动

### 1. 同轴转动



$\dfrac{v_1}{v_2}=\dfrac{r_1}{r_2}$


---

### 2. 皮带传动、齿轮传动



$\omega_1r_1=\omega_2r_2$



---

## 六、水平面内的圆周运动

### 1. 水平转盘模型

若物体随水平转盘一起转动，静摩擦力提供向心力：

$f=m\omega^2r$

或：

$f=m\dfrac{v^2}{r}$

最大静摩擦力：

$f_{\max}=\mu mg$

不打滑条件：

$m\omega^2r\leq \mu mg$

最大角速度：

$\omega_{\max}=\sqrt{\dfrac{\mu g}{r}}$

最大线速度：

$v_{\max}=\sqrt{\mu gr}$

最小周期：

$T_{\min}=2\pi\sqrt{\dfrac{r}{\mu g}}$

---

### 2. 圆锥摆模型

小球做水平圆周运动，绳长为 $l$，绳与竖直方向夹角为 $\theta$，圆周半径：

$r=l\sin\theta$

受力方程：

$T\cos\theta=mg$

$T\sin\theta=m\dfrac{v^2}{r}=m\omega^2r$

两式相除：

$\tan\theta=\dfrac{v^2}{rg}$

也可写成：

$\tan\theta=\dfrac{\omega^2r}{g}$

因为 $r=l\sin\theta$，所以：

$\omega^2=\dfrac{g}{l\cos\theta}$

周期：

$T_{\text{周期}}=2\pi\sqrt{\dfrac{l\cos\theta}{g}}$

---

### 3. 汽车水平转弯

若摩擦力提供向心力：

$f=m\dfrac{v^2}{r}$

最大静摩擦力：

$f_{\max}=\mu mg$

安全转弯条件：

$m\dfrac{v^2}{r}\leq \mu mg$

最大安全速度：

$v_{\max}=\sqrt{\mu gr}$

---

### 4. 倾斜路面转弯

若不考虑摩擦力，支持力与重力的合力提供向心力：

$N\cos\theta=mg$

$N\sin\theta=m\dfrac{v^2}{r}$

两式相除：

$\tan\theta=\dfrac{v^2}{rg}$

因此设计速度：

$v=\sqrt{rg\tan\theta}$

---

## 七、竖直平面内的圆周运动

### 1. 绳球模型最高点

在最高点，重力和绳子拉力都指向圆心：

$mg+T=m\dfrac{v^2}{r}$

绳子拉力：

$T=m\dfrac{v^2}{r}-mg$

能通过最高点的临界条件：

$T=0$

所以：

$mg=m\dfrac{v_{\min}^2}{r}$

最高点最小速度：

$v_{\min}=\sqrt{gr}$

---

### 2. 绳球模型最低点

在最低点，拉力指向圆心，重力背离圆心：

$T-mg=m\dfrac{v^2}{r}$

绳子拉力：

$T=mg+m\dfrac{v^2}{r}$

---

### 3. 轻杆模型最高点

轻杆既可以拉，也可以支持。

最高点方程一般写作：

$mg+F=m\dfrac{v^2}{r}$

其中 $F$ 表示杆对小球沿指向圆心方向的作用力。

如果 $v>\sqrt{gr}$，杆对小球表现为拉力：

$F=m\dfrac{v^2}{r}-mg$

如果 $v=\sqrt{gr}$，杆对小球作用力为零：

$F=0$

如果 $v<\sqrt{gr}$，杆对小球表现为支持力，方向背离圆心：

$F_{\text{支持}}=mg-m\dfrac{v^2}{r}$

轻杆模型通过最高点的最小速度可以为：

$v_{\min}=0$

---

### 4. 圆轨道内侧最高点

小球在圆环内侧最高点运动时，重力和支持力都指向圆心：

$mg+N=m\dfrac{v^2}{r}$

支持力：

$N=m\dfrac{v^2}{r}-mg$

不脱离轨道条件：

$N\geq0$

因此最高点最小速度：

$v_{\min}=\sqrt{gr}$

---

### 5. 圆轨道外侧最高点

小球在圆弧轨道外侧最高点运动时，重力指向圆心，支持力背离圆心：

$mg-N=m\dfrac{v^2}{r}$

支持力：

$N=mg-m\dfrac{v^2}{r}$

不脱离轨道条件：

$N\geq0$

所以：

$v\leq\sqrt{gr}$

---

## 八、过山车、圆环轨道常用能量公式

若小球从高度 $h$ 处由静止下滑，到达某位置高度为 $y$，忽略摩擦，则机械能守恒：

$mgh=mgy+\dfrac{1}{2}mv^2$

所以：

$v=\sqrt{2g(h-y)}$

若要通过竖直圆轨道最高点，最高点高度为 $2r$，且最高点最小速度为：

$v_{\min}=\sqrt{gr}$

由能量守恒：

$mgh=mg(2r)+\dfrac{1}{2}m v_{\min}^2$

代入：

$mgh=2mgr+\dfrac{1}{2}mgr$

因此最低释放高度：

$h_{\min}=\dfrac{5}{2}r$

---

## 九、万有引力提供向心力：天体圆周运动

### 1. 基本方程

万有引力提供向心力：

$G\dfrac{Mm}{r^2}=m\dfrac{v^2}{r}$

也可以写成：

$G\dfrac{Mm}{r^2}=m\omega^2r$

或：

$G\dfrac{Mm}{r^2}=m\dfrac{4\pi^2r}{T^2}$

---

### 2. 线速度

$v=\sqrt{\dfrac{GM}{r}}$

---

### 3. 角速度

$\omega=\sqrt{\dfrac{GM}{r^3}}$

---

### 4. 周期

$T=2\pi\sqrt{\dfrac{r^3}{GM}}$

---

### 5. 向心加速度

$a=\dfrac{GM}{r^2}$

---

### 6. 开普勒第三定律

对于绕同一中心天体运动的行星或卫星：

$\dfrac{r^3}{T^2}=k$

其中：

$k=\dfrac{GM}{4\pi^2}$

---

### 7. 近地卫星速度

近地卫星轨道半径近似为地球半径 $R$：

$v=\sqrt{\dfrac{GM}{R}}$

又因为：

$GM=gR^2$

所以：

$v=\sqrt{gR}$

数值约为：

$v\approx7.9\ \text{km/s}$

---

## 十、常见临界条件总结

### 1. 绳球通过最高点

$v_{\min}=\sqrt{gr}$

---

### 2. 轻杆通过最高点

$v_{\min}=0$

---

### 3. 圆环内侧最高点不脱轨

$v_{\min}=\sqrt{gr}$

---

### 4. 水平转盘物体不打滑

$m\omega^2r\leq \mu mg$

即：

$\omega\leq\sqrt{\dfrac{\mu g}{r}}$

---

### 5. 汽车水平转弯不侧滑

$v\leq\sqrt{\mu gr}$

---

### 6. 倾斜路面无摩擦转弯

$v=\sqrt{rg\tan\theta}$

---

## 十一、常用思想公式

圆周运动的核心不是背“向心力”，而是列径向合力：

$F_{\text{径向合}}=m\dfrac{v^2}{r}$

或：

$F_{\text{径向合}}=m\omega^2r$

解题时一般步骤：

1. 找圆心；
    
2. 确定半径；
    
3. 沿半径方向列牛顿第二定律；
    
4. 必要时结合能量守恒、动能定理或机械能守恒。